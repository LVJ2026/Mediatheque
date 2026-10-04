import { addDays, assertConfigured, gristRequest, normalizeBookLoan } from '../../_grist.js';
import { bookId, bookLoansTable, loadBookStock, syncBookAvailability } from '../../_books.js';
import { sendMail } from '../../_mail.js';

function dateInParis(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function sendSameDayConfirmation(env, input, records, created) {
  if (input.loan_date !== dateInParis(new Date())) return { status: 'pending', error: '' };
  try {
    const formatDate = (value) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
    const books = records.map(({ fields }) => `- ${fields.Titre} × ${fields.Quantite}`).join('\n');
    await sendMail(env, {
      to: input.professional_email,
      subject: 'Confirmation de votre emprunt de livres et albums',
      text: `Bonjour ${input.first_name} ${input.name},\n\nVotre emprunt commence aujourd’hui pour :\n${books}\n\nLe retour est prévu le ${formatDate(input.end_date)}.\n\nMédiathèque`,
    });
    const ids = (created.records || []).map((record) => record.id).filter((id) => Number.isInteger(id));
    if (ids.length) {
      await gristRequest(env, bookLoansTable(env), {
        method: 'PATCH',
        body: JSON.stringify({ records: ids.map((id) => ({ id, fields: { Confirmation_Envoyee: dateInParis(new Date()) } })) }),
      });
    }
    return { status: 'sent', error: '' };
  } catch (error) {
    const message = String(error.message || 'Erreur SMTP inconnue').slice(0, 200);
    console.error('Échec du courriel de confirmation livres :', message);
    return { status: 'failed', error: message };
  }
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function overlaps(loan, start, end) {
  return start <= (loan.occupied_until || loan.return_date) && end >= loan.loan_date;
}

export async function onRequestPost({ request, env, waitUntil }) {
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
        const alreadyReserved = overlapping.reduce((total, loan) => total + (loan.loan_date <= date && date <= loan.occupied_until ? loan.quantity : 0), 0);
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
    const confirmationDueToday = input.loan_date === dateInParis(new Date());
    const backgroundTasks = Promise.all([
      syncBookAvailability(env, totals).catch((error) => console.error('Mise à jour du stock livres impossible :', error.message)),
      sendSameDayConfirmation(env, input, records, created),
    ]);
    if (waitUntil) waitUntil(backgroundTasks);
    else await backgroundTasks;
    return Response.json(loans, { status: 201, headers: { 'X-Email-Status': confirmationDueToday ? 'sending' : 'pending' } });
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}