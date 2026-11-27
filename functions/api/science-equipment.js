import { assertConfigured, gristRequest } from '../_grist.js';
import { normalizeScienceEquipment, scienceInventoryTable } from '../_science.js';

export async function onRequestGet({ env }) {
  try {
    assertConfigured(env);
    const inventory = await gristRequest(env, scienceInventoryTable(env));
    return Response.json((inventory.records || []).map(normalizeScienceEquipment));
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
