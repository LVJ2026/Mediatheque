import { assertConfigured, gristRequest } from '../_grist.js';
import { normalizePedagogyBook, pedagogyInventoryTable } from '../_pedagogy.js';

export async function onRequestGet({ env }) {
  try {
    assertConfigured(env);
    const inventory = await gristRequest(env, pedagogyInventoryTable(env));
    return Response.json({ books: (inventory.records || []).map(normalizePedagogyBook) });
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
