import { assertConfigured, gristRequest, normalizeBookLoan } from '../_grist.js';
import { bookId, loansTable } from '../_books.js';

export async function onRequestGet({ env }) {
  try {
    assertConfigured(env);
    const payload = await gristRequest(env, loansTable(env));
    const records = (payload.records || []).filter((record) => {
      const fields = record.fields || {};
      return bookId(fields) > 0 && (fields.Date_Emprunt != null || fields['Date Emprunt'] != null);
    });
    return Response.json(records.map(normalizeBookLoan));
  } catch (error) {
    if (error.message.startsWith('Grist 404')) return Response.json([]);
    return Response.json({ detail: error.message }, { status: 503 });
  }
}