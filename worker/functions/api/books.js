import { assertConfigured, gristRequest, normalizeBook } from '../_grist.js';
import { booksTable } from '../_books.js';

export async function onRequestGet({ env }) {
  try {
    assertConfigured(env);
    const payload = await gristRequest(env, booksTable(env));
    return Response.json((payload.records || []).map(normalizeBook));
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}