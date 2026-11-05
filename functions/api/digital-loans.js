import { assertConfigured, gristRequest } from '../_grist.js';
import { digitalInventoryTable, digitalLoansTable, normalizeDigitalLoan } from '../_digital.js';

export async function onRequestGet({ env }) {
  try {
    assertConfigured(env);
    const [inventory, payload] = await Promise.all([
      gristRequest(env, digitalInventoryTable(env)),
      gristRequest(env, digitalLoansTable(env)),
    ]);
    const records = (payload.records || []).filter((record) => {
      const fields = record.fields || {};
      return fields.Equipement != null && (fields.Date_Emprunt != null || fields['Date Emprunt'] != null);
    });
    return Response.json(records.map((record) => normalizeDigitalLoan(record, inventory.records || [])));
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
