import { assertConfigured, gristRequest } from '../../_grist.js';
import { digitalInventoryTable, digitalLoansTable, normalizeDigitalLoan } from '../../_digital.js';
import { sendMail } from '../../_mail.js';
import { isManager, unauthorized } from '../../_manager.js';

function validIds(ids) {
  return Array.isArray(ids) && ids.length > 0
    && ids.every((id) => Number.isInteger(Number(id)) && Number(id) > 0)
    && new Set(ids.map(Number)).size === ids.length;
}

export async function onRequestPost({ request, env }) {
  if (!await isManager(request, env)) return unauthorized();
  try {
    assertConfigured(env);
    const input = await request.json();
    if (!validIds(input.loan_ids)) return Response.json({ detail: 'Identifiants de réservation invalides.' }, { status: 422 });

    const action = input.action || 'approve';
    if (action !== 'approve' && action !== 'send_confirmation') {
      return Response.json({ detail: 'Action de réservation invalide.' }, { status: 422 });
    }

    const payload = await gristRequest(env, digitalLoansTable(env));
    const ids = new Set(input.loan_ids.map(Number));
    const records = (payload.records || []).filter((record) => ids.has(Number(record.id)));
    if (records.length !== ids.size) return Response.json({ detail: 'Une pré-réservation est introuvable.' }, { status: 404 });
    if (records.some((record) => record.fields?.Retour || record.fields?.Date_Annulation)) {
      return Response.json({ detail: 'Cette pré-réservation est déjà clôturée.' }, { status: 409 });
    }

    const approved = records.filter((record) => record.fields?.Validee === true || record.fields?.Validee === 1);
    if (approved.length && approved.length !== records.length) {
      return Response.json({ detail: 'Les lignes de cette fiche ont des états de validation différents.' }, { status: 409 });
    }

    if (action === 'approve') {
      if (!approved.length) {
        await gristRequest(env, digitalLoansTable(env), {
          method: 'PATCH',
          body: JSON.stringify({ records: records.map((record) => ({ id: record.id, fields: { Validee: true } })) }),
        });
      }
      return Response.json({ approved: records.length, email_status: 'not_requested' });
    }

    if (!approved.length) {
      return Response.json({ detail: 'Validez d’abord la réservation avant d’envoyer sa confirmation.' }, { status: 409 });
    }
    if (records.some((record) => record.fields?.Confirmation_Envoyee)) {
      return Response.json({ detail: 'Le courriel de confirmation a déjà été envoyé.' }, { status: 409 });
    }

    const inventory = await gristRequest(env, digitalInventoryTable(env));
    const loans = records.map((record) => normalizeDigitalLoan({
      ...record,
      fields: { ...(record.fields || {}), Validee: true },
    }, inventory.records || []));
    const first = loans[0];
    const equipmentList = loans.map((loan) => `- ${loan.equipment_name} × ${loan.quantity}`).join('\n');
    const dateInParis = (date) => new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    const formatDate = (value) => new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${value}T12:00:00Z`));
    let emailStatus = 'sent';
    let emailError = '';
    try {
      await sendMail(env, {
        to: first.professional_email,
        subject: 'Confirmation de votre réservation de matériel numérique',
        text: `Bonjour ${first.first_name} ${first.name},\n\nVotre réservation est confirmée pour :\n${equipmentList}\n\nDu ${formatDate(first.loan_date)} au ${formatDate(first.return_date)}.\n\nMédiathèque`,
      });
      let trackingStatus = 'saved';
      let trackingError = '';
      try {
        await gristRequest(env, digitalLoansTable(env), {
          method: 'PATCH',
          body: JSON.stringify({
            records: records.map((record) => ({
              id: record.id,
              fields: { Confirmation_Envoyee: dateInParis(new Date()) },
            })),
          }),
        });
      } catch (error) {
        trackingStatus = 'failed';
        trackingError = String(error.message || 'Erreur de suivi inconnue').slice(0, 200);
        console.error('Courriel numérique envoyé, mais le marqueur de confirmation n’a pas été enregistré :', error.message);
      }
      return Response.json({
        approved: records.length,
        email_status: 'sent',
        tracking_status: trackingStatus,
        tracking_error: trackingError,
      });
    } catch (error) {
      emailStatus = 'failed';
      emailError = String(error.message || 'Erreur SMTP inconnue').slice(0, 200);
      console.error('Échec du courriel de validation du matériel numérique :', emailError);
    }
    return Response.json({ approved: records.length, email_status: emailStatus, email_error: emailError });
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
