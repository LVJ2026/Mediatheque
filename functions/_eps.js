import { addDays, gristRequest, toDate } from './_grist.js';

function epsInventoryTable(env) {
  return env.GRIST_EPS_INVENTORY_TABLE || 'Inventaire EPS';
}

function epsLoansTable(env) {
  return env.GRIST_EPS_LOANS_TABLE || 'Emprunts EPS';
}

function epsEquipmentId(fields) {
  return Number(fields.Materiel ?? fields['Matériel'] ?? fields.Equipement ?? fields.Equipment);
}

function epsQuantity(fields) {
  return Number(fields.Quantite ?? fields['Quantité'] ?? 1);
}

function isActiveEpsLoan(fields) {
  return epsEquipmentId(fields) > 0
    && (fields.Date_Emprunt != null || fields['Date Emprunt'] != null)
    && (fields.Retour == null || fields.Retour === '')
    && (fields.Date_Annulation == null || fields.Date_Annulation === '');
}

function normalizeEpsEquipment(record) {
  const fields = record.fields || {};
  const name = fields.Matériel ?? fields.Materiel ?? '';
  return {
    id: Number(record.id),
    Equipement: name,
    quantity: Number(fields.Quantite ?? fields['Quantité'] ?? 0),
    available_quantity: Number(fields.Reste ?? 0),
  };
}

function normalizeEpsLoan(record, inventoryRecords = []) {
  const fields = record.fields || {};
  const equipmentId = epsEquipmentId(fields);
  const equipment = inventoryRecords.find((item) => Number(item.id) === equipmentId);
  const loanDate = toDate(fields.Date_Emprunt ?? fields['Date Emprunt']);
  const returnedDate = fields.Retour == null || fields.Retour === '' ? null : toDate(fields.Retour);
  const cancelledDate = fields.Date_Annulation == null || fields.Date_Annulation === '' ? null : toDate(fields.Date_Annulation);
  const plannedEnd = [
    fields.Date_Retour_prevu,
    fields.Date_Fin,
    fields['Date retour prévu'],
    fields['Date Retour prévu'],
  ].find((value) => value != null && value !== '');
  const plannedEndDate = plannedEnd == null ? addDays(loanDate, 20) : toDate(plannedEnd);
  const returnDate = cancelledDate || returnedDate || plannedEndDate;
  const releasedEarly = Boolean(cancelledDate || returnedDate);
  return {
    id: Number(record.id),
    name: fields.Nom || '',
    first_name: fields.Prenom || fields['Prénom'] || '',
    professional_email: fields.Mail_professionnel || fields['Mail professionnel'] || '',
    school: fields.Ecole || '',
    loan_date: loanDate,
    return_date: returnDate,
    occupied_until: releasedEarly ? addDays(returnDate, -1) : returnDate,
    equipment_id: equipmentId,
    equipment_name: equipment?.fields?.Matériel ?? equipment?.fields?.Materiel ?? `Matériel ${equipmentId}`,
    quantity: epsQuantity(fields),
    is_approved: fields.Validee === true || fields.Validee === 1,
    confirmation_sent: Boolean(fields.Confirmation_Envoyee),
    is_active: !returnedDate && !cancelledDate,
    cancelled_date: cancelledDate,
    collection: 'eps',
  };
}

async function loadEpsStock(env) {
  const [inventory, loans] = await Promise.all([
    gristRequest(env, epsInventoryTable(env)),
    gristRequest(env, epsLoansTable(env)),
  ]);
  const totals = new Map((inventory.records || []).map((record) => [
    Number(record.id),
    Number(record.fields?.Quantite ?? record.fields?.['Quantité'] ?? 0),
  ]));
  const activeLoans = (loans.records || []).filter((record) => isActiveEpsLoan(record.fields || {}));
  return { inventory, loans, totals, activeLoans };
}

async function syncEpsAvailability(env, totals, inventoryPayload, loansPayload) {
  const [inventory, loans] = inventoryPayload && loansPayload
    ? [inventoryPayload, loansPayload]
    : await Promise.all([
      gristRequest(env, epsInventoryTable(env)),
      gristRequest(env, epsLoansTable(env)),
    ]);
  const borrowed = new Map([...totals.keys()].map((id) => [id, 0]));
  for (const record of loans.records || []) {
    const fields = record.fields || {};
    if (!isActiveEpsLoan(fields)) continue;
    const id = epsEquipmentId(fields);
    if (borrowed.has(id)) borrowed.set(id, borrowed.get(id) + epsQuantity(fields));
  }
  const records = (inventory.records || [])
    .filter((record) => totals.has(Number(record.id)))
    .filter((record) => Number(record.fields?.Qte_empruntee ?? 0) !== borrowed.get(Number(record.id)))
    .map((record) => ({
      id: record.id,
      fields: { Qte_empruntee: borrowed.get(Number(record.id)) },
    }));
  if (records.length) {
    await gristRequest(env, epsInventoryTable(env), {
      method: 'PATCH',
      body: JSON.stringify({ records }),
    });
  }
  return borrowed;
}

function overlapsEpsLoan(loan, start, end) {
  return loan.loan_date <= end && (loan.occupied_until || loan.return_date) >= start;
}

function availableEpsQuantity(equipmentId, start, end, total, loans) {
  const overlapping = loans.filter((loan) => loan.equipment_id === equipmentId && overlapsEpsLoan(loan, start, end));
  const changeDates = new Set([start]);
  for (const loan of overlapping) {
    if (loan.loan_date > start && loan.loan_date <= end) changeDates.add(loan.loan_date);
    const nextAvailable = addDays(loan.occupied_until || loan.return_date, 1);
    if (nextAvailable > start && nextAvailable <= end) changeDates.add(nextAvailable);
  }
  return Math.min(...[...changeDates].map((date) => {
    const reserved = overlapping
      .filter((loan) => loan.loan_date <= date && date <= (loan.occupied_until || loan.return_date))
      .reduce((sum, loan) => sum + loan.quantity, 0);
    return Math.max(0, total - reserved);
  }));
}

export {
  availableEpsQuantity,
  epsEquipmentId,
  epsInventoryTable,
  epsLoansTable,
  epsQuantity,
  isActiveEpsLoan,
  loadEpsStock,
  normalizeEpsEquipment,
  normalizeEpsLoan,
  syncEpsAvailability,
};
