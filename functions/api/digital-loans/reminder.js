import { assertConfigured, gristRequest } from '../../_grist.js';
import { digitalInventoryTable, digitalLoansTable, normalizeDigitalLoan } from '../../_digital.js';
import { sendMail } from '../../_mail.js';
import { isManager, unauthorized } from '../../_manager.js';

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

export async function onRequestPost({ request, env }) {
  if (!await isManager(request, env)) return unauthorized();
  try {
    assertConfigured(env);
    const input = await request.json();
    if (!Array.isArray(input.loan_ids) || !input.loan_ids.length
      || !input.loan_ids.every((id) => Number.isInteger(Number(id)) && Number(id) > 0)
      || new Set(input.loan_ids.map(Number)).size !== input.loan_ids.length) {
      return Response.json({ detail: 'Identifiants de réservation invalides.' }, { status: 422 });
    }

    const ids = new Set(input.loan_ids.map(Number));
    const [payload, inventory] = await Promise.all([
      gristRequest(env, digitalLoansTable(env)),
      gristRequest(env, digitalInventoryTable(env)),
    ]);
    const records = (payload.records || []).filter((record) => ids.has(Number(record.id)));
    if (records.length !== ids.size) return Response.json({ detail: 'Une réservation est introuvable.' }, { status: 404 });
    if (records.some((record) => record.fields?.Retour || record.fields?.Date_Annulation)) {
      return Response.json({ detail: 'Le matériel a déjà été retourné ou la réservation a été annulée.' }, { status: 409 });
    }

    const loans = records.map((record) => normalizeDigitalLoan(record, inventory.records || []));
    const dueDate = loans[0].return_date;
    if (loans.some((loan) => loan.return_date !== dueDate
      || loan.professional_email !== loans[0].professional_email)
      || dueDate > dateInParis(new Date())) {
      return Response.json({ detail: 'Le rappel est disponible à partir de la date de retour prévue.' }, { status: 409 });
    }

    const first = loans[0];
    const equipmentList = loans.map((loan) => `- ${loan.equipment_name} × ${loan.quantity}`).join('\n');
    await sendMail(env, {
      to: first.professional_email,
      subject: 'Rappel : retour de votre matériel numérique',
      text: `Bonjour ${first.first_name} ${first.name},\n\nSauf erreur de notre part, le matériel suivant devait être rendu le ${formatDate(dueDate)} :\n${equipmentList}\n\nMerci de prendre contact avec la circonscription pour organiser son retour.`,
    });
    return Response.json({ sent: true });
  } catch (error) {
    console.error('Échec du courriel de rappel du matériel numérique :', error.message);
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
