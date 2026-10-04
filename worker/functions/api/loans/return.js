import { assertConfigured, gristRequest } from '../../_grist.js';
import { bookId, loansTable, syncReservedQuantities } from '../../_books.js';
import { isManager, unauthorized } from '../../_manager.js';

export async function onRequestPost({ request, env }) {
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
    const table = loansTable(env);
    const loanPayload = await gristRequest(env, table);
    const selectedIds = new Set(input.loan_ids.map(Number));
    const affectedBooks = (loanPayload.records || [])
      .filter((record) => selectedIds.has(Number(record.id)))
      .map((record) => bookId(record.fields || {}))
      .filter((id) => Number.isInteger(id) && id > 0);
    const records = input.loan_ids.map((id) => ({ id: Number(id), fields: { Retour: input.return_date } }));
    await gristRequest(env, table, {
      method: 'PATCH',
      body: JSON.stringify({ records }),
    });
    await syncReservedQuantities(env, affectedBooks);
    return Response.json({ updated: records.length });
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}