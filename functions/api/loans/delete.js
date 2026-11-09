import { assertConfigured, gristRequest } from '../../_grist.js';
import { bookLoansTable, loansTable, syncCurrentBookAvailability } from '../../_books.js';
import { digitalInventoryTable, digitalLoansTable, syncDigitalAvailability } from '../../_digital.js';
import { sendMail } from '../../_mail.js';
import { isManager, unauthorized } from '../../_manager.js';

export async function onRequestPost({ request, env, waitUntil }) {
  if (!await isManager(request, env)) return unauthorized();
  try {
    assertConfigured(env);
    const input = await request.json();
    const parsedDate = new Date(`${input.cancelled_date}T12:00:00`);
    const validDate = typeof input.cancelled_date === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(input.cancelled_date)
      && Number.isFinite(parsedDate.getTime())
      && parsedDate.toISOString().slice(0, 10) === input.cancelled_date;
    if (!Array.isArray(input.loan_ids) || !input.loan_ids.length
      || !input.loan_ids.every((id) => Number.isInteger(Number(id)) && Number(id) > 0)
      || new Set(input.loan_ids.map(Number)).size !== input.loan_ids.length || !validDate) {
      return Response.json({ detail: 'Identifiants ou date d’annulation invalides.' }, { status: 422 });
    }
    const isBooks = input.collection === 'books';
    const isDigital = input.collection === 'digital';
    const table = isBooks ? bookLoansTable(env) : isDigital ? digitalLoansTable(env) : loansTable(env);
    const ids = new Set(input.loan_ids.map(Number));
    const payload = await gristRequest(env, table);
    const loans = (payload.records || []).filter((record) => ids.has(Number(record.id)));
    if (loans.length !== ids.size) return Response.json({ detail: 'Une réservation à annuler est introuvable.' }, { status: 404 });
    const records = input.loan_ids.map((id) => ({ id: Number(id), fields: { Date_Annulation: input.cancelled_date } }));
    await gristRequest(env, table, {
      method: 'PATCH',
      body: JSON.stringify({ records }),
    });
    if (isBooks) {
      const stockSync = syncCurrentBookAvailability(env).catch((error) => console.error('Mise à jour du stock après annulation impossible :', error.message));
      if (waitUntil) waitUntil(stockSync);
      else await stockSync;
    } else if (isDigital) {
      const inventory = await gristRequest(env, digitalInventoryTable(env));
      const totals = new Map((inventory.records || []).map((record) => [
        Number(record.id), Number(record.fields?.Quantite ?? record.fields?.['Quantité'] ?? 0),
      ]));
      await syncDigitalAvailability(env, totals);
    }
    const loanEmails = loans
      .map((record) => record.fields?.Mail_professionnel || record.fields?.['Mail professionnel'])
      .filter((email) => typeof email === 'string' && email.trim())
      .map((email) => email.trim());
    const recipients = [...new Set(loanEmails)];
    let emailStatus = 'sent';
    const emailErrors = [];
    let sentRecipients = 0;
    if (loanEmails.length !== loans.length) emailErrors.push('Une réservation ne comporte pas d’adresse de courriel.');
    if (!recipients.length) emailErrors.push('Aucune adresse de courriel valide n’est associée à cette réservation.');
    for (const to of recipients) {
      try {
        await sendMail(env, {
          to,
          subject: 'Annulation de votre réservation',
          text: 'Bonjour,\n\nVotre réservation a été annulée. Pour connaître les raisons de cette annulation, veuillez prendre contact avec la circonscription.',
        });
        sentRecipients += 1;
      } catch (error) {
        emailErrors.push(String(error.message || 'Erreur SMTP inconnue').slice(0, 200));
      }
    }
    if (emailErrors.length) {
      emailStatus = sentRecipients ? 'partial' : 'failed';
      console.error('Échec du courriel d’annulation :', emailErrors.join(' '));
    }
    return Response.json({
      updated: records.length,
      email_status: emailStatus,
      email_error: emailErrors.join(' '),
    });
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}