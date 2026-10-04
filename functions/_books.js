import { gristRequest } from './_grist.js';

function booksTable(env) {
  return env.GRIST_BOOKS_INVENTORY_TABLE || 'Inventaire livres albums';
}

function bookLoansTable(env) {
  return env.GRIST_BOOKS_LOANS_TABLE || 'Emprunts livres albums';
}

function bookKey(fields) {
  return [fields.Titre, fields.Auteur, fields.Lieu].map((value) => String(value ?? '').trim()).join('\u001f');
}

function bookId(fields, inventoryRecords) {
  const key = bookKey(fields);
  const record = inventoryRecords.find((item) => bookKey(item.fields || {}) === key);
  return record?.id;
}

function bookQuantity(fields) {
  return Number(fields.Quantite ?? fields['Quantité'] ?? 1);
}

function isActiveBookLoan(fields) {
  return Boolean(fields.Titre)
    && fields.Date_Emprunt != null
    && fields.Date_Emprunt !== ''
    && (fields.Retour == null || fields.Retour === '')
    && (fields.Date_Annulation == null || fields.Date_Annulation === '');
}

async function loadBookStock(env) {
  const [inventory, loans] = await Promise.all([
    gristRequest(env, booksTable(env)),
    gristRequest(env, bookLoansTable(env)),
  ]);
  const totals = new Map((inventory.records || []).map((record) => [
    Number(record.id), Number(record.fields?.Quantite ?? record.fields?.['Quantité'] ?? 0),
  ]));
  for (const record of loans.records || []) {
    const fields = record.fields || {};
    if (!isActiveBookLoan(fields)) continue;
    const id = Number(bookId(fields, inventory.records || []));
    if (totals.has(id)) totals.set(id, totals.get(id) + bookQuantity(fields));
  }
  return { inventory, loans, totals };
}

async function syncBookAvailability(env, totalQuantities) {
  const [inventory, loans] = await Promise.all([
    gristRequest(env, booksTable(env)),
    gristRequest(env, bookLoansTable(env)),
  ]);
  const reserved = new Map([...totalQuantities.keys()].map((id) => [id, 0]));
  for (const record of loans.records || []) {
    const fields = record.fields || {};
    if (!isActiveBookLoan(fields)) continue;
    const id = Number(bookId(fields, inventory.records || []));
    if (reserved.has(id)) reserved.set(id, reserved.get(id) + bookQuantity(fields));
  }

  const records = (inventory.records || [])
    .filter((record) => totalQuantities.has(Number(record.id)))
    .map((record) => ({
      id: record.id,
      fields: { Quantite: totalQuantities.get(Number(record.id)) - reserved.get(Number(record.id)) },
    }));
  if (records.length) {
    await gristRequest(env, booksTable(env), {
      method: 'PATCH',
      body: JSON.stringify({ records }),
    });
  }
}

export { bookId, bookKey, bookLoansTable, bookQuantity, booksTable, isActiveBookLoan, loadBookStock, syncBookAvailability };