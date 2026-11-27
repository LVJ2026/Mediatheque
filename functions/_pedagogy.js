import { addDays, gristRequest, normalizeLoan, toDate } from './_grist.js';

function pedagogyInventoryTable(env) {
  return env.GRIST_PEDAGOGY_INVENTORY_TABLE || 'Inventaire peda';
}

function pedagogyLoansTable(env) {
  return env.GRIST_PEDAGOGY_LOANS_TABLE || 'Emprunts peda';
}

function normalizePedagogyBook(record) {
  const fields = record.fields || {};
  return {
    id: Number(record.id),
    Titre: fields.Titre ?? fields.Titre_du_livre ?? '',
    Auteur: fields.Auteur ?? '',
    Edition: fields.Edition ?? fields['Édition'] ?? '',
  };
}

function pedagogyBookId(fields, inventoryRecords) {
  const reference = Number(fields.Titre ?? fields.Livre ?? fields.Livre_pedagogique);
  const referencedBook = inventoryRecords.find((record) => Number(record.id) === reference);
  if (referencedBook) return Number(referencedBook.id);
  const title = String(fields.Titre ?? '').trim();
  const author = String(fields.Auteur ?? '').trim();
  const edition = String(fields.Edition ?? fields['Édition'] ?? '').trim();
  const book = inventoryRecords.find((record) => {
    const fields = record.fields || {};
    return String(fields.Titre ?? fields.Titre_du_livre ?? '').trim() === title
      && String(fields.Auteur ?? '').trim() === author
      && String(fields.Edition ?? fields['Édition'] ?? '').trim() === edition;
  });
  return book ? Number(book.id) : 0;
}

function normalizePedagogyLoan(record, inventoryRecords = []) {
  const fields = record.fields || {};
  const bookId = pedagogyBookId(fields, inventoryRecords);
  const book = inventoryRecords.find((item) => Number(item.id) === bookId);
  const loanDate = toDate(fields.Date_Emprunt ?? fields['Date Emprunt']);
  const returnedDate = fields.Retour == null || fields.Retour === '' ? null : toDate(fields.Retour);
  const cancelledDate = fields.Date_Annulation == null || fields.Date_Annulation === '' ? null : toDate(fields.Date_Annulation);
  const plannedEnd = fields.Date_Retour_prevu ?? fields.Date_Fin ?? fields['Date retour prévu'];
  const plannedEndDate = plannedEnd == null || plannedEnd === '' ? addDays(loanDate, 20) : toDate(plannedEnd);
  const returnDate = cancelledDate || returnedDate || plannedEndDate;
  const endedEarly = Boolean(cancelledDate || returnedDate);
  return {
    ...normalizeLoan(record),
    game_id: null,
    return_date: returnDate,
    occupied_until: endedEarly ? addDays(returnDate, -1) : returnDate,
    book_id: bookId,
    book_title: book?.fields?.Titre ?? book?.fields?.Titre_du_livre ?? fields.Titre ?? '',
    book_author: book?.fields?.Auteur ?? fields.Auteur ?? '',
    book_edition: book?.fields?.Edition ?? book?.fields?.['Édition'] ?? fields.Edition ?? fields['Édition'] ?? '',
    is_approved: fields.Validee === true || fields.Validee === 1,
    confirmation_sent: Boolean(fields.Confirmation_Envoyee),
    is_active: !returnedDate && !cancelledDate,
    cancelled_date: cancelledDate,
    collection: 'pedagogy',
  };
}

export {
  normalizePedagogyBook,
  normalizePedagogyLoan,
  pedagogyBookId,
  pedagogyInventoryTable,
  pedagogyLoansTable,
};
