import { assertConfigured, gristRequest } from '../../_grist.js';
import {
  availableDigitalQuantity,
  digitalLoansTable,
  loadDigitalStock,
  normalizeDigitalLoan,
  syncDigitalAvailability,
} from '../../_digital.js';
import { sendMail } from '../../_mail.js';

function dateInParis(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}

async function sendRequestEmail(env, input, selection, inventoryById, created) {
  const equipmentList = selection.map((item) => {
    const equipment = inventoryById.get(Number(item.id));
    return `- ${equipment?.fields?.Nom_Equipement || equipment?.fields?.Equipement || `Équipement ${item.id}`} × ${item.quantity}`;
  }).join('\n');
  const dateRange = `Du ${formatDate(input.loan_date)} au ${formatDate(input.end_date)}.`;
  const interfaceUrl = new URL('/#numerique', input.interface_url).href;
  let borrowerStatus = 'sent';
  let borrowerError = '';
  try {
    await sendMail(env, {
      to: input.professional_email,
      subject: 'Réception de votre demande de réservation de matériel numérique',
      text: `Bonjour ${input.first_name} ${input.name},\n\nNous avons bien reçu votre demande de réservation pour :\n${equipmentList}\n\n${dateRange}\nCette demande est en attente de validation par le gestionnaire. Vous recevrez un courriel lorsque la réservation sera validée.`,
    });
  } catch (error) {
    borrowerStatus = 'failed';
    borrowerError = String(error.message || 'Erreur SMTP inconnue').slice(0, 200);
    console.error('Échec du courriel de réception du matériel numérique :', borrowerError);
  }

  let trackingStatus = 'not-saved';
  let trackingError = '';
  if (borrowerStatus === 'sent') {
    const ids = (created.records || []).map((record) => record.id).filter((id) => Number.isInteger(id));
    if (!ids.length) {
      trackingStatus = 'failed';
      trackingError = 'Les identifiants Grist des réservations sont indisponibles.';
      console.error(`${trackingError} Le courriel de demande a bien été envoyé, mais son suivi est impossible.`);
    } else {
      try {
        await gristRequest(env, digitalLoansTable(env), {
          method: 'PATCH',
          body: JSON.stringify({
            records: ids.map((id) => ({ id, fields: { Demande_Envoyee: dateInParis(new Date()) } })),
          }),
        });
        trackingStatus = 'saved';
      } catch (error) {
        trackingStatus = 'failed';
        trackingError = String(error.message || 'Erreur de suivi inconnue').slice(0, 200);
        console.error('Courriel numérique envoyé, mais le marqueur de demande n’a pas été enregistré :', trackingError);
      }
    }
  }

  const managerEmails = [...new Set([env.MANAGER_EMAIL1, env.MANAGER_EMAIL2]
    .map((email) => typeof email === 'string' ? email.trim() : '')
    .filter(Boolean))];
  const managerErrors = [];
  let managerSent = 0;
  if (!managerEmails.length) {
    managerErrors.push('Aucune adresse MANAGER_EMAIL1 ou MANAGER_EMAIL2 n’est configurée dans Cloudflare.');
  } else {
    for (const email of managerEmails) {
      try {
        await sendMail(env, {
          to: email,
          subject: 'Nouvelle pré-réservation de matériel numérique à valider',
          text: `Une nouvelle pré-réservation de matériel numérique attend votre validation.\n\nDemandeur : ${input.first_name} ${input.name}\nÉcole : ${input.school}\nCourriel : ${input.professional_email}\n${dateRange}\n\nMatériel demandé :\n${equipmentList}\n\nOuvrir l’interface gestionnaire : ${interfaceUrl}`,
        });
        managerSent += 1;
      } catch (error) {
        const message = String(error.message || 'Erreur SMTP inconnue').slice(0, 200);
        managerErrors.push(message);
        console.error('Échec du courriel de notification à un gestionnaire :', message);
      }
    }
  }

  const managerStatus = managerSent === managerEmails.length && managerSent > 0
    ? 'sent'
    : managerSent > 0 ? 'partial' : 'failed';
  return {
    borrowerStatus,
    borrowerError,
    trackingStatus,
    trackingError,
    managerStatus,
    managerError: managerErrors.join(' '),
  };
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function onRequestPost({ request, env }) {
  try {
    assertConfigured(env);
    const input = await request.json();
    const selection = input.equipment;
    if (!input.name || !input.first_name || !input.professional_email || !input.school
      || !isValidDate(input.loan_date) || !isValidDate(input.end_date) || input.end_date < input.loan_date
      || !Array.isArray(selection) || selection.length !== 1
      || selection.some((item) => !Number.isInteger(Number(item.id)) || Number(item.id) < 1
        || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1)
      || new Set(selection.map((item) => Number(item.id))).size !== selection.length) {
      return Response.json({ detail: 'Renseignez tous les champs, vérifiez la quantité et les dates, et sélectionnez un seul équipement.' }, { status: 422 });
    }

    const { inventory, activeLoans, totals } = await loadDigitalStock(env);
    const inventoryById = new Map((inventory.records || []).map((record) => [Number(record.id), record]));
    const normalizedLoans = activeLoans.map((record) => normalizeDigitalLoan(record, inventory.records || []));
    for (const item of selection) {
      const id = Number(item.id);
      const equipment = inventoryById.get(id);
      if (!equipment) return Response.json({ detail: 'Un équipement sélectionné est introuvable dans l’inventaire.' }, { status: 409 });
      const total = totals.get(id) ?? 0;
      const available = availableDigitalQuantity(id, input.loan_date, input.end_date, total, normalizedLoans);
      if (available < Number(item.quantity)) {
        const equipmentName = equipment.fields?.Nom_Equipement || equipment.fields?.Equipement || `l’équipement ${id}`;
        const unit = available === 1 ? 'exemplaire disponible' : 'exemplaires disponibles';
        return Response.json({
          detail: `Stock insuffisant pour ${equipmentName} : ${available} ${unit} sur la période choisie.`,
        }, { status: 409 });
      }
    }

    const records = selection.map((item) => ({ fields: {
      Nom: input.name,
      Prenom: input.first_name,
      Mail_professionnel: input.professional_email,
      Ecole: input.school,
      Date_Emprunt: input.loan_date,
      Date_Retour_prevu: input.end_date,
      Equipement: Number(item.id),
      Quantite: Number(item.quantity),
      Validee: false,
    } }));
    const created = await gristRequest(env, digitalLoansTable(env), {
      method: 'POST',
      body: JSON.stringify({ records }),
    });
    const loans = records.map((record, index) => normalizeDigitalLoan({
      id: created.records?.[index]?.id,
      fields: record.fields,
    }, inventory.records || []));
    let stockStatus = 'updated';
    try {
      await syncDigitalAvailability(env, totals);
    } catch (error) {
      stockStatus = 'failed';
      console.error('Mise à jour du stock numérique impossible après pré-réservation :', error.message);
    }
    const email = await sendRequestEmail(env, { ...input, interface_url: request.url }, selection, inventoryById, created);
    const headers = {
      'X-Stock-Status': stockStatus,
      'X-Email-Status': email.borrowerStatus,
      'X-Email-Tracking-Status': email.trackingStatus,
      'X-Manager-Email-Status': email.managerStatus,
    };
    if (email.borrowerError) headers['X-Email-Error'] = encodeURIComponent(email.borrowerError);
    if (email.trackingError) headers['X-Email-Tracking-Error'] = encodeURIComponent(email.trackingError);
    if (email.managerError) headers['X-Manager-Email-Error'] = encodeURIComponent(email.managerError);
    return Response.json(loans, {
      status: 201,
      headers,
    });
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
