import { assertConfigured, normalizeBook } from '../_grist.js';
import { loadBookStock } from '../_books.js';

export async function onRequestGet({ env }) {
  try {
    assertConfigured(env);
    const { inventory, totals } = await loadBookStock(env);
    return Response.json((inventory.records || []).map((record) => ({
      ...normalizeBook(record),
      quantity: totals.get(Number(record.id)) ?? 0,
      available_quantity: Number(record.fields?.Quantite ?? record.fields?.['Quantité'] ?? 0),
    })));
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}