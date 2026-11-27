import { addDays, gristRequest, normalizeLoan, toDate } from './_grist.js';

function scienceInventoryTable(env) {
  return env.GRIST_SCIENCE_INVENTORY_TABLE || 'Inventaires sciences';
}

function scienceLoansTable(env) {
  return env.GRIST_SCIENCE_LOANS_TABLE || 'Emprunts sciences';
}

function scienceEquipmentId(fields) {
  return Number(fields.Materiel ?? fields['Matériel'] ?? fields.Equipement ?? fields['Équipement'] ?? fields.Equipment);
}

function isActiveScienceLoan(fields) {
  return scienceEquipmentId(fields) > 0
    && (fields.Date_Emprunt != null || fields['Date Emprunt'] != null)
    && (fields.Retour == null || fields.Retour === '')
    && (fields.Date_Annulation == null || fields.Date_Annulation === '');
}

function scienceEquipmentName(fields) {
  return fields.Matériel ?? fields.Materiel ?? fields.Equipement ?? fields['Équipement']
    ?? fields.Equipment ?? fields.Nom ?? fields['Nom du matériel'] ?? '';
}

function normalizeScienceEquipment(record) {
  const fields = record.fields || {};
  return {
    id: Number(record.id),
    Equipement: scienceEquipmentName(fields),
  };
}

function normalizeScienceLoan(record, inventoryRecords = []) {
  const fields = record.fields || {};
  const equipmentId = scienceEquipmentId(fields);
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
  const endedEarly = Boolean(cancelledDate || returnedDate);
  return {
    ...normalizeLoan(record),
    game_id: null,
    return_date: returnDate,
    occupied_until: endedEarly ? addDays(returnDate, -1) : returnDate,
    equipment_id: equipmentId,
    equipment_name: equipment ? scienceEquipmentName(equipment.fields || {}) : `Matériel ${equipmentId}`,
    quantity: 1,
    is_active: !returnedDate && !cancelledDate,
    cancelled_date: cancelledDate,
    collection: 'science',
  };
}

async function loadScienceStock(env) {
  const [inventory, loans] = await Promise.all([
    gristRequest(env, scienceInventoryTable(env)),
    gristRequest(env, scienceLoansTable(env)),
  ]);
  const totals = new Map((inventory.records || []).map((record) => {
    const equipment = normalizeScienceEquipment(record);
    return [equipment.id, 1];
  }));
  const activeLoans = (loans.records || []).filter((record) => isActiveScienceLoan(record.fields || {}));
  return { inventory, loans, totals, activeLoans };
}

function availableScienceQuantity(equipmentId, start, end, total, loans) {
  const overlapping = loans.filter((loan) => loan.equipment_id === equipmentId
    && loan.loan_date <= end && (loan.occupied_until || loan.return_date) >= start);
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
  availableScienceQuantity,
  isActiveScienceLoan,
  loadScienceStock,
  normalizeScienceEquipment,
  normalizeScienceLoan,
  scienceEquipmentId,
  scienceEquipmentName,
  scienceInventoryTable,
  scienceLoansTable,
};
