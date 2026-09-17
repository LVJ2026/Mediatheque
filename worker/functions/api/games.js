import { assertConfigured, gristRequest, normalizeGame } from '../_grist.js';

export async function onRequestGet({ env }) {
  try {
    assertConfigured(env);
    const payload = await gristRequest(env, env.GRIST_INVENTORY_TABLE || 'Inventaire_des_jeux');
    return Response.json((payload.records || []).map(normalizeGame));
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
