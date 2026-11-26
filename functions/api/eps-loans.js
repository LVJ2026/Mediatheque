import { assertConfigured, gristRequest } from '../_grist.js';
import { epsInventoryTable, epsLoansTable, normalizeEpsLoan } from '../_eps.js';

export async function onRequestGet({ env }) {
  try {
    assertConfigured(env);
    const [inventory, payload] = await Promise.all([
      gristRequest(env, epsInventoryTable(env)),
      gristRequest(env, epsLoansTable(env)),
    ]);
    const records = (payload.records || []).filter((record) => {
      const fields = record.fields || {};
      return fields.Materiel != null || fields['Matériel'] != null || fields.Equipement != null;
    }).filter((record) => record.fields?.Date_Emprunt != null || record.fields?.['Date Emprunt'] != null);
    return Response.json(records.map((record) => normalizeEpsLoan(record, inventory.records || [])));
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
