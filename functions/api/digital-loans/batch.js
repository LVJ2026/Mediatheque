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
    return `- ${equipment?.fields?.Equipement || `Équipement ${item.id}`} × ${item.quantity}`;
  }).join('\n');
  try {
    await sendMail(env, {
      to: input.professional_email,
      subject: 'Réception de votre demande de réservation de matériel numérique',
      text: `Bonjour ${input.first_name} ${input.name},\n\nNous avons bien reçu votre demande de réservation pour :\n${equipmentList}\n\nDu ${formatDate(input.loan_date)} au ${formatDate(input.end_date)}.\nCette demande est en attente de validation par le gestionnaire. Vous recevrez un courriel lorsque la réservation sera validée.\n\nMédiathèque`,
    });
  } catch (error) {
    const message = String(error.message || 'Erreur SMTP inconnue').slice(0, 200);
    console.error('Échec du courriel de réception du matériel numérique :', message);
    return { status: 'failed', tracking: 'not-saved', error: message };
  }

  const ids = (created.records || []).map((record) => record.id).filter((id) => Number.isInteger(id));
  if (!ids.length) {
    const message = 'Les identifiants Grist des réservations sont indisponibles.';
    console.error(`${message} Le courriel de demande a bien été envoyé, mais son suivi est impossible.`);
    return { status: 'sent', tracking: 'failed', error: message };
  }
  try {
    await gristRequest(env, digitalLoansTable(env), {
      method: 'PATCH',
      body: JSON.stringify({
        records: ids.map((id) => ({ id, fields: { Demande_Envoyee: dateInParis(new Date()) } })),
      }),
    });
    return { status: 'sent', tracking: 'saved', error: '' };
  } catch (error) {
    const message = String(error.message || 'Erreur de suivi inconnue').slice(0, 200);
    console.error('Courriel numérique envoyé, mais le marqueur de demande n’a pas été enregistré :', message);
    return { status: 'sent', tracking: 'failed', error: message };
  }
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
      || !Array.isArray(selection) || !selection.length
      || selection.some((item) => !Number.isInteger(Number(item.id)) || Number(item.id) < 1
        || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1)
      || new Set(selection.map((item) => Number(item.id))).size !== selection.length) {
      return Response.json({ detail: 'Tous les champs sont obligatoires; vérifiez les quantités et la période.' }, { status: 422 });
    }

    const { inventory, activeLoans, totals } = await loadDigitalStock(env);
    const inventoryById = new Map((inventory.records || []).map((record) => [Number(record.id), record]));
    const normalizedLoans = activeLoans.map((record) => normalizeDigitalLoan(record, inventory.records || []));
    for (const item of selection) {
      const id = Number(item.id);
      const equipment = inventoryById.get(id);
      if (!equipment) return Response.json({ detail: 'Un équipement sélectionné est introuvable dans l’inventaire.' }, { status: 409 });
      const total = totals.get(id) ?? 0;
      if (availableDigitalQuantity(id, input.loan_date, input.end_date, total, normalizedLoans) < Number(item.quantity)) {
        return Response.json({ detail: `Stock insuffisant pour ${equipment.fields?.Equipement || `l’équipement ${id}`} sur cette période.` }, { status: 409 });
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
    const email = await sendRequestEmail(env, input, selection, inventoryById, created);
    const headers = {
      'X-Stock-Status': stockStatus,
      'X-Email-Status': email.status,
      'X-Email-Tracking-Status': email.tracking,
    };
    if (email.error) headers['X-Email-Error'] = encodeURIComponent(email.error);
    return Response.json(loans, {
      status: 201,
      headers,
    });
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
