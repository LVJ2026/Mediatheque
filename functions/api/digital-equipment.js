import { assertConfigured, gristRequest } from '../_grist.js';
import {
  digitalInventoryTable,
  digitalLoansTable,
  normalizeDigitalEquipment,
  syncDigitalAvailability,
} from '../_digital.js';

export async function onRequestGet({ env }) {
  try {
    assertConfigured(env);
    const [inventory, loans] = await Promise.all([
      gristRequest(env, digitalInventoryTable(env)),
      gristRequest(env, digitalLoansTable(env)),
    ]);
    const totals = new Map((inventory.records || []).map((record) => [
      Number(record.id),
      Number(record.fields?.Quantite ?? record.fields?.['Quantité'] ?? 0),
    ]));
    const borrowed = await syncDigitalAvailability(env, totals, inventory, loans);
    const records = (inventory.records || []).map((record) => {
      const id = Number(record.id);
      const quantity = totals.get(id) ?? 0;
      const remaining = Math.max(0, quantity - (borrowed.get(id) ?? 0));
      return normalizeDigitalEquipment({
        ...record,
        fields: { ...(record.fields || {}), Reste: remaining },
      });
    });
    return Response.json(records);
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
