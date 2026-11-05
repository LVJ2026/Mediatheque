import { assertConfigured, gristRequest } from '../../_grist.js';
import {
  availableDigitalQuantity,
  digitalLoansTable,
  loadDigitalStock,
  normalizeDigitalLoan,
  syncDigitalAvailability,
} from '../../_digital.js';

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function onRequestPost({ request, env }) {
  try {
    assertConfigured(env);
    const input = await request.json();
    const selection = input.equipment;
    if (!input.name || !input.first_name || !input.professional_email || !input.school
      || !isValidDate(input.loan_date) || !isValidDate(input.end_date) || input.end_date < input.loan_date
      || !Array.isArray(selection) || !selection.length
      || selection.some((item) => !Number.isInteger(Number(item.id)) || Number(item.id) < 1
        || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1)
      || new Set(selection.map((item) => Number(item.id))).size !== selection.length) {
      return Response.json({ detail: 'Tous les champs sont obligatoires; vérifiez les quantités et la période.' }, { status: 422 });
    }

    const { inventory, activeLoans, totals } = await loadDigitalStock(env);
    const inventoryById = new Map((inventory.records || []).map((record) => [Number(record.id), record]));
    const normalizedLoans = activeLoans.map((record) => normalizeDigitalLoan(record, inventory.records || []));
    for (const item of selection) {
      const id = Number(item.id);
      const equipment = inventoryById.get(id);
      if (!equipment) return Response.json({ detail: 'Un équipement sélectionné est introuvable dans l’inventaire.' }, { status: 409 });
      const total = totals.get(id) ?? 0;
      if (availableDigitalQuantity(id, input.loan_date, input.end_date, total, normalizedLoans) < Number(item.quantity)) {
        return Response.json({ detail: `Stock insuffisant pour ${equipment.fields?.Equipement || `l’équipement ${id}`} sur cette période.` }, { status: 409 });
      }
    }

    const records = selection.map((item) => ({ fields: {
      Nom: input.name,
      Prenom: input.first_name,
      Mail_professionnel: input.professional_email,
      Ecole: input.school,
      Date_Emprunt: input.loan_date,
      Date_Retour_prevu: input.end_date,
      Equipement: Number(item.id),
      Quantite: Number(item.quantity),
      Validee: false,
    } }));
    const created = await gristRequest(env, digitalLoansTable(env), {
      method: 'POST',
      body: JSON.stringify({ records }),
    });
    const loans = records.map((record, index) => normalizeDigitalLoan({
      id: created.records?.[index]?.id,
      fields: record.fields,
    }, inventory.records || []));
    let stockStatus = 'updated';
    try {
      await syncDigitalAvailability(env, totals);
    } catch (error) {
      stockStatus = 'failed';
      console.error('Mise à jour du stock numérique impossible après pré-réservation :', error.message);
    }
    return Response.json(loans, {
      status: 201,
      headers: { 'X-Stock-Status': stockStatus, 'X-Email-Status': 'pending' },
    });
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
