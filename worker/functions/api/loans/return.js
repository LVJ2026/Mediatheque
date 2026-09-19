import { assertConfigured, gristRequest, normalizeLoan } from '../../_grist.js';
import { isManager, unauthorized } from '../../_manager.js';

export async function onRequestPost({ request, env }) {
  if (!await isManager(request, env)) return unauthorized();
  try {
    assertConfigured(env);
    const { id, return_date: returnDate } = await request.json();
    if (!Number.isInteger(Number(id)) || !/^\d{4}-\d{2}-\d{2}$/.test(returnDate || '')) return Response.json({ detail: 'Date de retour invalide.' }, { status: 422 });
    const payload = await gristRequest(env, env.GRIST_LOANS_TABLE || 'Table1', { method: 'PATCH', body: JSON.stringify({ records: [{ id: Number(id), fields: { Retour: returnDate } }] }) });
    return Response.json(normalizeLoan(payload.records?.[0] || { id: Number(id), fields: { Retour: returnDate } }));
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
