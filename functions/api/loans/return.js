import { assertConfigured, gristRequest } from '../../_grist.js';
import { bookLoansTable, loansTable, syncCurrentBookAvailability } from '../../_books.js';
import { digitalLoansTable, digitalInventoryTable, syncDigitalAvailability } from '../../_digital.js';
import { isManager, unauthorized } from '../../_manager.js';

export async function onRequestPost({ request, env, waitUntil }) {
  if (!await isManager(request, env)) return unauthorized();
  try {
    assertConfigured(env);
    const input = await request.json();
    const parsedDate = new Date(`${input.return_date}T12:00:00`);
    const validDate = typeof input.return_date === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(input.return_date)
      && Number.isFinite(parsedDate.getTime())
      && parsedDate.toISOString().slice(0, 10) === input.return_date;
    if (!Array.isArray(input.loan_ids) || !input.loan_ids.length || !input.loan_ids.every((id) => Number.isInteger(Number(id)) && Number(id) > 0) || !validDate) {
      return Response.json({ detail: 'Identifiants ou date de retour invalides.' }, { status: 422 });
    }
    const isBooks = input.collection === 'books';
    const isDigital = input.collection === 'digital';
    const table = isBooks ? bookLoansTable(env) : isDigital ? digitalLoansTable(env) : loansTable(env);
    const records = input.loan_ids.map((id) => ({ id: Number(id), fields: { Retour: input.return_date } }));
    await gristRequest(env, table, {
      method: 'PATCH',
      body: JSON.stringify({ records }),
    });
    if (isBooks) {
      const stockSync = syncCurrentBookAvailability(env).catch((error) => console.error('Mise à jour du stock après retour impossible :', error.message));
      if (waitUntil) waitUntil(stockSync);
      else await stockSync;
    } else if (isDigital) {
      const inventory = await gristRequest(env, digitalInventoryTable(env));
      const totals = new Map((inventory.records || []).map((record) => [
        Number(record.id), Number(record.fields?.Quantite ?? record.fields?.['Quantité'] ?? 0),
      ]));
      const stockSync = syncDigitalAvailability(env, totals).catch((error) => console.error('Mise à jour du stock numérique après retour impossible :', error.message));
      if (waitUntil) waitUntil(stockSync);
      else await stockSync;
    }
    return Response.json({ updated: records.length });
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}