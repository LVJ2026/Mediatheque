import { assertConfigured, gristRequest } from '../../_grist.js';
import { normalizePedagogyLoan, pedagogyInventoryTable, pedagogyLoansTable } from '../../_pedagogy.js';
import { sendMail } from '../../_mail.js';
import { isManager, unauthorized } from '../../_manager.js';

function dateInParis(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
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
      gristRequest(env, pedagogyLoansTable(env)),
      gristRequest(env, pedagogyInventoryTable(env)),
    ]);
    const records = (payload.records || []).filter((record) => ids.has(Number(record.id)));
    if (records.length !== ids.size) return Response.json({ detail: 'Une pré-réservation est introuvable.' }, { status: 404 });
    if (records.some((record) => record.fields?.Retour || record.fields?.Date_Annulation)) {
      return Response.json({ detail: 'Cette pré-réservation est déjà clôturée.' }, { status: 409 });
    }
    if (records.every((record) => record.fields?.Validee === true || record.fields?.Validee === 1)
      && records.some((record) => record.fields?.Confirmation_Envoyee)) {
      return Response.json({ detail: 'Le courriel de confirmation a déjà été envoyé.' }, { status: 409 });
    }

    await gristRequest(env, pedagogyLoansTable(env), {
      method: 'PATCH',
      body: JSON.stringify({ records: records.map((record) => ({ id: record.id, fields: { Validee: true } })) }),
    });
    const loans = records.map((record) => normalizePedagogyLoan({
      ...record,
      fields: { ...(record.fields || {}), Validee: true },
    }, inventory.records || []));
    const first = loans[0];
    const bookList = loans.map((loan) => `- ${loan.book_title} — ${loan.book_author} (${loan.book_edition})`).join('\n');
    try {
      await sendMail(env, {
        to: first.professional_email,
        subject: 'Confirmation de votre réservation de livre pédagogique',
        text: `Bonjour ${first.first_name} ${first.name},\n\nVotre réservation est confirmée pour :\n${bookList}\n\nDu ${formatDate(first.loan_date)} au ${formatDate(first.return_date)}.\n\nPrendre contact avec la circonscription pour les modalités de récupération de l’emprunt.`,
      });
    } catch (error) {
      const message = String(error.message || 'Erreur de confirmation inconnue').slice(0, 200);
      console.error('Échec de la confirmation du livre pédagogique :', message);
      return Response.json({ approved: records.length, email_status: 'failed', email_error: message });
    }
    try {
      await gristRequest(env, pedagogyLoansTable(env), {
        method: 'PATCH',
        body: JSON.stringify({
          records: records.map((record) => ({
            id: record.id,
            fields: { Confirmation_Envoyee: dateInParis(new Date()) },
          })),
        }),
      });
      return Response.json({ approved: records.length, email_status: 'sent', tracking_status: 'saved' });
    } catch (error) {
      const message = String(error.message || 'Erreur de suivi inconnue').slice(0, 200);
      console.error('Courriel pédagogique envoyé, mais son suivi Grist a échoué :', message);
      return Response.json({
        approved: records.length,
        email_status: 'sent',
        tracking_status: 'failed',
        tracking_error: message,
      });
    }
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
