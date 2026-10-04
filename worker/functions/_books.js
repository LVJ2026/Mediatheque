import { gristRequest } from './_grist.js';

function bookId(fields) {
  const reference = fields.Livre_album ?? fields.Livre_Album;
  return Number(Array.isArray(reference) ? reference[1] : reference);
}

function booksTable(env) {
  return env.GRIST_BOOKS_INVENTORY_TABLE || 'Inventaire livres albums';
}

function loansTable(env) {
  return env.GRIST_LOANS_TABLE || 'Table1';
}

function isActiveBookLoan(fields) {
  return bookId(fields) > 0
    && fields.Date_Emprunt != null
    && fields.Date_Emprunt !== ''
    && (fields.Retour == null || fields.Retour === '')
    && (fields.Date_Annulation == null || fields.Date_Annulation === '');
}

async function syncReservedQuantities(env, affectedBookIds) {
  const ids = new Set(affectedBookIds.map(Number));
  if (!ids.size) return;

  const [inventory, loans] = await Promise.all([
    gristRequest(env, booksTable(env)),
    gristRequest(env, loansTable(env)),
  ]);
  const reserved = new Map([...ids].map((id) => [id, 0]));
  for (const record of loans.records || []) {
    const fields = record.fields || {};
    if (!isActiveBookLoan(fields)) continue;
    const id = bookId(fields);
    if (reserved.has(id)) {
      reserved.set(id, reserved.get(id) + Number(fields.Quantite_demandee ?? fields['Quantité demandée'] ?? 1));
    }
  }

  const records = (inventory.records || [])
    .filter((record) => reserved.has(Number(record.id)))
    .map((record) => ({ id: record.id, fields: { Quantite_reservee: reserved.get(Number(record.id)) } }));
  if (records.length) {
    await gristRequest(env, booksTable(env), {
      method: 'PATCH',
      body: JSON.stringify({ records }),
    });
  }
}

export { bookId, booksTable, isActiveBookLoan, loansTable, syncReservedQuantities };