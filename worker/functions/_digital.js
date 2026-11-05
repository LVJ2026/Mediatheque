import { addDays } from './_grist.js';

function digitalInventoryTable(env) {
  return env.GRIST_DIGITAL_INVENTORY_TABLE || 'Inventaire Numerique';
}

function digitalLoansTable(env) {
  return env.GRIST_DIGITAL_LOANS_TABLE || 'Emprunt Numerique';
}

function toDate(value) {
  if (typeof value === 'number') {
    const timestamp = Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) throw new Error('Date invalide reçue depuis Grist.');
    return date.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function normalizeDigitalLoan(record, inventoryRecords = []) {
  const fields = record.fields || {};
  const equipmentId = Number(fields.Equipement);
  const equipment = inventoryRecords.find((item) => Number(item.id) === equipmentId);
  const loanDate = toDate(fields.Date_Emprunt ?? fields['Date Emprunt']);
  const returnedDate = fields.Retour == null || fields.Retour === '' ? null : toDate(fields.Retour);
  const cancelledDate = fields.Date_Annulation == null || fields.Date_Annulation === '' ? null : toDate(fields.Date_Annulation);
  const plannedEndDate = fields.Date_Fin == null || fields.Date_Fin === '' ? addDays(loanDate, 20) : toDate(fields.Date_Fin);
  const returnDate = cancelledDate || returnedDate || plannedEndDate;
  return {
    id: Number(record.id),
    name: fields.Nom || '',
    first_name: fields.Prenom || fields['Prénom'] || '',
    professional_email: fields.Mail_professionnel || fields['Mail professionnel'] || '',
    school: fields.Ecole || '',
    loan_date: loanDate,
    return_date: returnDate,
    equipment_id: equipmentId,
    equipment_name: equipment?.fields?.Equipement || `Équipement ${equipmentId}`,
    quantity: Number(fields.Quantite ?? fields['Quantité'] ?? 1),
  };
}

export { digitalInventoryTable, digitalLoansTable, normalizeDigitalLoan };
