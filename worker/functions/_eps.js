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
  };
}

export { epsInventoryTable, epsLoansTable, normalizeEpsLoan };
