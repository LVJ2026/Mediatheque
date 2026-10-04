import { addDays, assertConfigured, gristRequest, normalizeBookLoan } from '../../_grist.js';
import { bookLoansTable, bookId, bookQuantity, booksTable, loadBookStock, syncBookAvailability } from '../../_books.js';

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function overlaps(loan, start, end) {
  return start <= (loan.occupied_until || loan.return_date) && end >= loan.loan_date;
}

export async function onRequestPost({ request, env }) {
  try {
    assertConfigured(env);
    const input = await request.json();
    const selection = input.books;
    if (!input.name || !input.first_name || !input.professional_email || !input.school
      || !isValidDate(input.loan_date) || !isValidDate(input.end_date) || input.end_date < input.loan_date
      || !Array.isArray(selection) || !selection.length
      || selection.some((item) => !Number.isInteger(Number(item.id)) || Number(item.id) < 1
        || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1)
      || new Set(selection.map((item) => Number(item.id))).size !== selection.length) {
      return Response.json({ detail: 'Tous les champs sont obligatoires; vérifiez les quantités et la période.' }, { status: 422 });
    }

    const { inventory: inventoryPayload, loans: loansPayload, totals } = await loadBookStock(env);
    const inventory = new Map((inventoryPayload.records || []).map((record) => [Number(record.id), record]));
    const activeLoans = (loansPayload.records || [])
      .filter((record) => {
        const fields = record.fields || {};
        return bookId(fields, inventoryPayload.records || []) > 0 && (fields.Date_Emprunt != null || fields['Date Emprunt'] != null);
      })
      .map((record) => normalizeBookLoan(record, inventoryPayload.records || []));

    for (const item of selection) {
      const id = Number(item.id);
      const book = inventory.get(id);
      if (!book) return Response.json({ detail: 'Une série sélectionnée est introuvable dans l’inventaire.' }, { status: 409 });
      const quantity = totals.get(id) ?? 0;
      if (!Number.isFinite(quantity) || quantity < Number(item.quantity)) {
        return Response.json({ detail: `La quantité demandée dépasse le stock de la série ${book.fields?.Titre || id}.` }, { status: 409 });
      }
      const overlapping = activeLoans.filter((loan) => loan.book_id === id && overlaps(loan, input.loan_date, input.end_date));
      const changeDates = new Set([input.loan_date]);
      for (const loan of overlapping) {
        if (loan.loan_date > input.loan_date) changeDates.add(loan.loan_date);
        const nextAvailableDay = addDays(loan.occupied_until, 1);
        if (nextAvailableDay <= input.end_date) changeDates.add(nextAvailableDay);
      }
      for (const date of changeDates) {
        const alreadyReserved = overlapping.reduce((total, loan) => total + (loan.loan_date <= date && date <= loan.occupied_until ? bookQuantity({ Quantite: loan.quantity }) : 0), 0);
        if (alreadyReserved + Number(item.quantity) > quantity) {
          return Response.json({ detail: `Stock insuffisant pour ${book.fields?.Titre || `la série ${id}`} du ${date}.` }, { status: 409 });
        }
      }
    }

    const records = selection.map((item) => ({ fields: {
      Nom: input.name,
      Prenom: input.first_name,
      Mail_professionnel: input.professional_email,
      Ecole: input.school,
      Date_Emprunt: input.loan_date,
      Date_Fin: input.end_date,
      Titre: inventory.get(Number(item.id)).fields?.Titre || '',
      Auteur: inventory.get(Number(item.id)).fields?.Auteur ?? '',
      Lieu: inventory.get(Number(item.id)).fields?.Lieu ?? '',
      Quantite: Number(item.quantity),
    } }));
    const created = await gristRequest(env, bookLoansTable(env), {
      method: 'POST',
      body: JSON.stringify({ records }),
    });
    const loans = records.map((record, index) => normalizeBookLoan({
      id: created.records?.[index]?.id,
      fields: record.fields,
    }, inventoryPayload.records || []));
    await syncBookAvailability(env, totals);
    return Response.json(loans, { status: 201, headers: { 'X-Email-Status': 'pending' } });
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}