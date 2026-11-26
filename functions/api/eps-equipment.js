import { assertConfigured, gristRequest } from '../_grist.js';
import { epsInventoryTable, normalizeEpsEquipment } from '../_eps.js';

export async function onRequestGet({ env }) {
  try {
    assertConfigured(env);
    const inventory = await gristRequest(env, epsInventoryTable(env));
    return Response.json((inventory.records || []).map(normalizeEpsEquipment));
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
