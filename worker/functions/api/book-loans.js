import { assertConfigured, gristRequest, normalizeBookLoan } from '../_grist.js';
import { bookLoansTable, booksTable } from '../_books.js';

export async function onRequestGet({ env }) {
  try {
    assertConfigured(env);
    const [inventory, payload] = await Promise.all([
      gristRequest(env, booksTable(env)),
      gristRequest(env, bookLoansTable(env)),
    ]);
    const records = (payload.records || []).filter((record) => {
      const fields = record.fields || {};
      return Boolean(fields.Titre) && (fields.Date_Emprunt != null || fields['Date Emprunt'] != null);
    });
    return Response.json(records.map((record) => normalizeBookLoan(record, inventory.records || [])));
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}