import { assertConfigured, gristRequest } from '../../_grist.js';
import {
  availableEpsQuantity,
  epsLoansTable,
  loadEpsStock,
  normalizeEpsLoan,
} from '../../_eps.js';
import { sendMail } from '../../_mail.js';

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}

function dateInParis(date) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function sendRequestEmails(env, input, equipment, created) {
  const item = equipment.get(Number(input.equipment[0].id));
  const itemName = item?.fields?.Matériel ?? item?.fields?.Materiel ?? 'Matériel EPS';
  const quantity = Number(input.equipment[0].quantity);
  const dateRange = `Du ${formatDate(input.loan_date)} au ${formatDate(input.end_date)}.`;
  const managerUrl = new URL('/#eps', input.interface_url).href;
  let borrowerStatus = 'sent';
  let borrowerError = '';
  try {
    await sendMail(env, {
      to: input.professional_email,
      subject: 'Réception de votre demande de réservation de matériel EPS',
      text: `Bonjour ${input.first_name} ${input.name},\n\nNous avons bien reçu votre demande de réservation pour :\n- ${itemName} × ${quantity}\n\n${dateRange}\nCette demande est en attente de validation par le gestionnaire. Vous recevrez un courriel lorsque la réservation sera validée.`,
    });
  } catch (error) {
    borrowerStatus = 'failed';
    borrowerError = String(error.message || 'Erreur SMTP inconnue').slice(0, 200);
    console.error('Échec du courriel de réception du matériel EPS :', borrowerError);
  }

  let trackingStatus = 'not-saved';
  let trackingError = '';
  if (borrowerStatus === 'sent') {
    const ids = (created.records || []).map((record) => record.id).filter(Number.isInteger);
    try {
      if (!ids.length) throw new Error('Les identifiants Grist des réservations sont indisponibles.');
      await gristRequest(env, epsLoansTable(env), {
        method: 'PATCH',
        body: JSON.stringify({ records: ids.map((id) => ({ id, fields: { Demande_Envoyee: dateInParis(new Date()) } })) }),
      });
      trackingStatus = 'saved';
    } catch (error) {
      trackingStatus = 'failed';
      trackingError = String(error.message || 'Erreur de suivi inconnue').slice(0, 200);
      console.error('Courriel EPS envoyé, mais le marqueur de demande n’a pas été enregistré :', trackingError);
    }
  }

  const managers = [...new Set([env.MANAGER_EMAIL1, env.MANAGER_EMAIL2]
    .map((email) => typeof email === 'string' ? email.trim() : '').filter(Boolean))];
  const managerErrors = [];
  let managerSent = 0;
  if (!managers.length) managerErrors.push('Aucune adresse MANAGER_EMAIL1 ou MANAGER_EMAIL2 n’est configurée dans Cloudflare.');
  for (const to of managers) {
    try {
      await sendMail(env, {
        to,
        subject: 'Nouvelle pré-réservation de matériel EPS à valider',
        text: `Une nouvelle pré-réservation de matériel EPS attend votre validation.\n\nDemandeur : ${input.first_name} ${input.name}\nÉcole : ${input.school}\nCourriel : ${input.professional_email}\n${dateRange}\n\nMatériel demandé :\n- ${itemName} × ${quantity}\n\nOuvrir l’interface gestionnaire : ${managerUrl}`,
      });
      managerSent += 1;
    } catch (error) {
      const message = String(error.message || 'Erreur SMTP inconnue').slice(0, 200);
      managerErrors.push(message);
      console.error('Échec du courriel de notification EPS à un gestionnaire :', message);
    }
  }
  return {
    borrowerStatus,
    borrowerError,
    trackingStatus,
    trackingError,
    managerStatus: managerSent === managers.length && managerSent > 0 ? 'sent' : managerSent ? 'partial' : 'failed',
    managerError: managerErrors.join(' '),
  };
}

export async function onRequestPost({ request, env }) {
  try {
    assertConfigured(env);
    const input = await request.json();
    const selection = input.equipment;
    if (!input.name || !input.first_name || !input.professional_email || !input.school
      || !isValidDate(input.loan_date) || !isValidDate(input.end_date) || input.end_date < input.loan_date
      || !Array.isArray(selection) || selection.length !== 1
      || !Number.isInteger(Number(selection[0]?.id)) || Number(selection[0].id) < 1
      || !Number.isInteger(Number(selection[0]?.quantity)) || Number(selection[0].quantity) < 1) {
      return Response.json({ detail: 'Renseignez tous les champs, vérifiez la quantité et les dates, et sélectionnez un seul équipement.' }, { status: 422 });
    }

    const { inventory, activeLoans, totals } = await loadEpsStock(env);
    const inventoryById = new Map((inventory.records || []).map((record) => [Number(record.id), record]));
    const loans = activeLoans.map((record) => normalizeEpsLoan(record, inventory.records || []));
    const selected = selection[0];
    const id = Number(selected.id);
    const equipment = inventoryById.get(id);
    if (!equipment) return Response.json({ detail: 'Un équipement sélectionné est introuvable dans l’inventaire EPS.' }, { status: 409 });
    const available = availableEpsQuantity(id, input.loan_date, input.end_date, totals.get(id) ?? 0, loans);
    if (available < Number(selected.quantity)) {
      const name = equipment.fields?.Matériel ?? equipment.fields?.Materiel ?? `l’équipement ${id}`;
      return Response.json({ detail: `Stock insuffisant pour ${name} : ${available} exemplaire${available === 1 ? '' : 's'} disponible${available === 1 ? '' : 's'} sur la période choisie.` }, { status: 409 });
    }

    const record = { fields: {
      Nom: input.name,
      Prenom: input.first_name,
      Mail_professionnel: input.professional_email,
      Ecole: input.school,
      Date_Emprunt: input.loan_date,
      Date_Retour_prevu: input.end_date,
      Materiel: id,
      Quantite: Number(selected.quantity),
      Validee: false,
    } };
    const created = await gristRequest(env, epsLoansTable(env), {
      method: 'POST',
      body: JSON.stringify({ records: [record] }),
    });
    const result = normalizeEpsLoan({ id: created.records?.[0]?.id, ...record }, inventory.records || []);
    const email = await sendRequestEmails(env, { ...input, interface_url: request.url }, inventoryById, created);
    const headers = {
      'X-Email-Status': email.borrowerStatus,
      'X-Email-Tracking-Status': email.trackingStatus,
      'X-Manager-Email-Status': email.managerStatus,
    };
    if (email.borrowerError) headers['X-Email-Error'] = encodeURIComponent(email.borrowerError);
    if (email.trackingError) headers['X-Email-Tracking-Error'] = encodeURIComponent(email.trackingError);
    if (email.managerError) headers['X-Manager-Email-Error'] = encodeURIComponent(email.managerError);
    return Response.json([result], { status: 201, headers });
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
