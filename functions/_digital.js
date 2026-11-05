import { addDays, gristRequest, toDate } from './_grist.js';

function digitalInventoryTable(env) {
  return env.GRIST_DIGITAL_INVENTORY_TABLE || 'Inventaire Numerique';
}

function digitalLoansTable(env) {
  return env.GRIST_DIGITAL_LOANS_TABLE || 'Emprunts Numeriques';
}

function digitalQuantity(fields) {
  return Number(fields.Quantite ?? fields['Quantité'] ?? 1);
}

function digitalEquipmentId(fields) {
  return Number(fields.Equipement);
}

function isActiveDigitalLoan(fields) {
  return Number(fields.Equipement) > 0
    && fields.Date_Emprunt != null
    && fields.Date_Emprunt !== ''
    && (fields.Retour == null || fields.Retour === '')
    && (fields.Date_Annulation == null || fields.Date_Annulation === '');
}

function normalizeDigitalEquipment(record) {
  const fields = record.fields || {};
  return {
    id: Number(record.id),
    Equipement: fields.Equipement ?? '',
    Marque: fields.Marque ?? '',
    Type: fields.Type ?? '',
    quantity: Number(fields.Quantite ?? fields['Quantité'] ?? 0),
    available_quantity: Number(fields.Reste ?? fields['Reste'] ?? fields.Quantite ?? fields['Quantité'] ?? 0),
  };
}

function normalizeDigitalLoan(record, inventoryRecords = []) {
  const fields = record.fields || {};
  const equipmentId = digitalEquipmentId(fields);
  const equipment = inventoryRecords.find((item) => Number(item.id) === equipmentId);
  const loanDate = toDate(fields.Date_Emprunt ?? fields['Date Emprunt']);
  const returnedDate = fields.Retour == null || fields.Retour === '' ? null : toDate(fields.Retour);
  const cancelledDate = fields.Date_Annulation == null || fields.Date_Annulation === '' ? null : toDate(fields.Date_Annulation);
  const plannedEndDate = fields.Date_Fin == null || fields.Date_Fin === '' ? addDays(loanDate, 20) : toDate(fields.Date_Fin);
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
    equipment_name: equipment?.fields?.Equipement || `Équipement ${equipmentId}`,
    quantity: digitalQuantity(fields),
    is_approved: fields.Validee === true || fields.Validee === 1,
    is_active: !returnedDate && !cancelledDate,
    cancelled_date: cancelledDate,
    collection: 'digital',
  };
}

async function loadDigitalStock(env) {
  const [inventory, loans] = await Promise.all([
    gristRequest(env, digitalInventoryTable(env)),
    gristRequest(env, digitalLoansTable(env)),
  ]);
  const totals = new Map((inventory.records || []).map((record) => [
    Number(record.id),
    Number(record.fields?.Quantite ?? record.fields?.['Quantité'] ?? 0),
  ]));
  const activeLoans = (loans.records || []).filter((record) => isActiveDigitalLoan(record.fields || {}));
  return { inventory, loans, totals, activeLoans };
}

async function syncDigitalAvailability(env, totals) {
  const [inventory, loans] = await Promise.all([
    gristRequest(env, digitalInventoryTable(env)),
    gristRequest(env, digitalLoansTable(env)),
  ]);
  const borrowed = new Map([...totals.keys()].map((id) => [id, 0]));
  for (const record of loans.records || []) {
    const fields = record.fields || {};
    if (!isActiveDigitalLoan(fields)) continue;
    const id = digitalEquipmentId(fields);
    if (borrowed.has(id)) borrowed.set(id, borrowed.get(id) + digitalQuantity(fields));
  }
  const records = (inventory.records || [])
    .filter((record) => totals.has(Number(record.id)))
    .map((record) => ({
      id: record.id,
      fields: { Qte_empruntee: borrowed.get(Number(record.id)) },
    }));
  if (records.length) {
    await gristRequest(env, digitalInventoryTable(env), {
      method: 'PATCH',
      body: JSON.stringify({ records }),
    });
  }
}

function overlapsDigitalLoan(loan, start, end) {
  return loan.loan_date <= end && (loan.occupied_until || loan.return_date) >= start;
}

function availableDigitalQuantity(equipmentId, start, end, total, loans) {
  const overlapping = loans.filter((loan) => loan.equipment_id === equipmentId && overlapsDigitalLoan(loan, start, end));
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
  availableDigitalQuantity,
  digitalEquipmentId,
  digitalInventoryTable,
  digitalLoansTable,
  digitalQuantity,
  isActiveDigitalLoan,
  loadDigitalStock,
  normalizeDigitalEquipment,
  normalizeDigitalLoan,
  syncDigitalAvailability,
};
