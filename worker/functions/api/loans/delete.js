import { assertConfigured, gristRequest } from '../../_grist.js';
import { isManager, unauthorized } from '../../_manager.js';

export async function onRequestPost({ request, env }) {
  if (!await isManager(request, env)) return unauthorized();
  try {
    assertConfigured(env);
    const { id } = await request.json();
    if (!Number.isInteger(Number(id))) return Response.json({ detail: 'Réservation invalide.' }, { status: 422 });
    await gristRequest(env, env.GRIST_LOANS_TABLE || 'Table1', { method: 'DELETE', body: JSON.stringify({ records: [Number(id)] }) });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
