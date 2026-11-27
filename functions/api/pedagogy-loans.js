import { assertConfigured, gristRequest } from '../_grist.js';
import { normalizePedagogyLoan, pedagogyInventoryTable, pedagogyLoansTable } from '../_pedagogy.js';
import { isManager } from '../_manager.js';

export async function onRequestGet({ request, env }) {
  try {
    assertConfigured(env);
    const [inventory, payload] = await Promise.all([
      gristRequest(env, pedagogyInventoryTable(env)),
      gristRequest(env, pedagogyLoansTable(env)),
    ]);
    const records = (payload.records || []).filter((record) => {
      const fields = record.fields || {};
      return fields.Titre != null && (fields.Date_Emprunt != null || fields['Date Emprunt'] != null);
    });
    const loans = records.map((record) => normalizePedagogyLoan(record, inventory.records || []));
    if (await isManager(request, env)) return Response.json(loans);
    return Response.json(loans.map((loan) => ({
      id: loan.id,
      book_id: loan.book_id,
      loan_date: loan.loan_date,
      return_date: loan.return_date,
      occupied_until: loan.occupied_until,
      is_approved: loan.is_approved,
      is_active: loan.is_active,
    })));
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
