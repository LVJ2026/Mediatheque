import { assertConfigured, gristRequest } from '../_grist.js';
import { digitalInventoryTable, normalizeDigitalEquipment } from '../_digital.js';

export async function onRequestGet({ env }) {
  try {
    assertConfigured(env);
    const payload = await gristRequest(env, digitalInventoryTable(env));
    return Response.json((payload.records || []).map(normalizeDigitalEquipment));
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
