import { assertConfigured, gristRequest } from '../_grist.js';
import { normalizeScienceLoan, scienceInventoryTable, scienceLoansTable } from '../_science.js';
import { isManager } from '../_manager.js';

export async function onRequestGet({ request, env }) {
  try {
    assertConfigured(env);
    const [inventory, payload] = await Promise.all([
      gristRequest(env, scienceInventoryTable(env)),
      gristRequest(env, scienceLoansTable(env)),
    ]);
    const records = (payload.records || []).filter((record) => {
      const fields = record.fields || {};
      return fields.Materiel != null || fields['Matériel'] != null
        || fields.Equipement != null || fields['Équipement'] != null;
    }).filter((record) => record.fields?.Date_Emprunt != null || record.fields?.['Date Emprunt'] != null);
    const loans = records.map((record) => normalizeScienceLoan(record, inventory.records || []));
    if (await isManager(request, env)) return Response.json(loans);
    return Response.json(loans.map((loan) => ({
      id: loan.id,
      equipment_id: loan.equipment_id,
      loan_date: loan.loan_date,
      return_date: loan.return_date,
      occupied_until: loan.occupied_until,
      quantity: loan.quantity,
      is_active: loan.is_active,
    })));
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
