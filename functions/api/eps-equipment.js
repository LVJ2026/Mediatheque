import { assertConfigured } from '../_grist.js';
import { loadEpsStock, normalizeEpsEquipment, syncEpsAvailability } from '../_eps.js';

export async function onRequestGet({ env }) {
  try {
    assertConfigured(env);
    const { inventory, loans, totals } = await loadEpsStock(env);
    const borrowed = await syncEpsAvailability(env, totals, inventory, loans);
    return Response.json((inventory.records || []).map((record) => {
      const id = Number(record.id);
      const quantity = totals.get(id) ?? 0;
      return normalizeEpsEquipment({
        ...record,
        fields: { ...(record.fields || {}), Reste: Math.max(0, quantity - (borrowed.get(id) ?? 0)) },
      });
    }));
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
