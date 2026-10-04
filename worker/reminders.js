import { assertConfigured, gristRequest, normalizeBookLoan, normalizeLoan } from './functions/_grist.js';
import { bookLoansTable, booksTable, isActiveBookLoan } from './functions/_books.js';
import { sendMail } from './functions/_mail.js';

const TIME_ZONE = 'Europe/Paris';

function dateInParis(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(value, amount) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function formatDate(value) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function hasDate(value) {
  return value != null && value !== '';
}

function reminderKey(loan) {
  return JSON.stringify([
    loan.professional_email.trim().toLowerCase(),
    loan.name,
    loan.first_name,
    loan.school,
    loan.loan_date,
    loan.return_date,
  ]);
}

async function sendReminders(env, now) {
  assertConfigured(env);
  const today = dateInParis(now);
  const reminderDate = addDays(today, 3);
  const table = env.GRIST_LOANS_TABLE || 'Emprunts';
  const [payload, bookInventory, bookPayload] = await Promise.all([
    gristRequest(env, table),
    gristRequest(env, booksTable(env)),
    gristRequest(env, bookLoansTable(env)),
  ]);
  const groups = new Map();
  const bookStarts = new Map();
  const bookReturns = new Map();

  for (const record of payload.records || []) {
    const fields = record.fields || {};
    const loanDate = fields.Date_Emprunt ?? fields['Date Emprunt'];
    if (fields.Jeu == null || !hasDate(loanDate)) continue;
    if (hasDate(fields.Retour) || hasDate(fields.Date_Annulation)) continue;

    const loan = normalizeLoan(record);
    if (loan.return_date !== reminderDate) continue;

    const key = reminderKey(loan);
    if (!groups.has(key)) {
      groups.set(key, {
        borrower: loan,
        records: [],
        gameIds: new Set(),
        alreadySent: false,
      });
    }
    const group = groups.get(key);
    group.records.push(record);
    group.gameIds.add(loan.game_id);
    group.alreadySent ||= hasDate(fields.Rappel_Envoye);
  }

  for (const record of bookPayload.records || []) {
    const fields = record.fields || {};
    if (!isActiveBookLoan(fields)) continue;
    const loan = normalizeBookLoan(record, bookInventory.records || []);
    const key = reminderKey(loan);
    if (loan.loan_date === today && !hasDate(fields.Confirmation_Envoyee)) {
      if (!bookStarts.has(key)) bookStarts.set(key, { borrower: loan, records: [], quantities: new Map() });
      const group = bookStarts.get(key);
      group.records.push(record);
      group.quantities.set(loan.book_id, (group.quantities.get(loan.book_id) || 0) + loan.quantity);
    }
    if (loan.return_date === reminderDate && !hasDate(fields.Rappel_Envoye)) {
      if (!bookReturns.has(key)) bookReturns.set(key, { borrower: loan, records: [], quantities: new Map() });
      const group = bookReturns.get(key);
      group.records.push(record);
      group.quantities.set(loan.book_id, (group.quantities.get(loan.book_id) || 0) + loan.quantity);
    }
  }

  const dueGroups = [...groups.values()].filter((group) => !group.alreadySent);
  const dueBookGroups = [...bookStarts.values()].map((group) => ({ ...group, notice: 'start' }))
    .concat([...bookReturns.values()].map((group) => ({ ...group, notice: 'return' })));
  if (!dueGroups.length && !dueBookGroups.length) return;

  const gamesById = new Map();
  try {
    const inventory = await gristRequest(env, env.GRIST_INVENTORY_TABLE || 'Inventaire_des_jeux');
    for (const record of inventory.records || []) {
      gamesById.set(Number(record.id), record.fields?.Jeu || `Jeu ${record.id}`);
    }
  } catch (error) {
    console.error('Noms des jeux indisponibles pour les rappels :', error.message);
  }

  for (const group of dueGroups) {
    const loan = group.borrower;
    const games = [...group.gameIds].map((id) => gamesById.get(id) || `Jeu ${id}`);
    const gameList = games.map((name) => `- ${name}`).join('\n');
    try {
      await sendMail(env, {
        to: loan.professional_email,
        subject: 'Rappel : retour de votre réservation dans 3 jours',
        text: `Bonjour ${loan.first_name} ${loan.name},\n\nNous vous rappelons que le retour prévu pour :\n${gameList}\nest le ${formatDate(loan.return_date)}.\n\nMédiathèque`,
      });
      await gristRequest(env, table, {
        method: 'PATCH',
        body: JSON.stringify({
          records: group.records.map((record) => ({
            id: record.id,
            fields: { Rappel_Envoye: today },
          })),
        }),
      });
      console.log(`Rappel envoyé pour ${loan.professional_email} (${loan.return_date}).`);
    } catch (error) {
      console.error(`Échec du rappel pour ${loan.professional_email} :`, error.message);
    }
  }

  if (dueBookGroups.length) {
    const booksById = new Map();
    for (const record of bookInventory.records || []) {
      booksById.set(Number(record.id), record.fields?.Titre || `Série ${record.id}`);
    }

    for (const group of dueBookGroups) {
      const loan = group.borrower;
      const bookList = [...group.quantities].map(([id, quantity]) => `- ${booksById.get(id) || `Série ${id}`} × ${quantity}`).join('\n');
      const isStart = group.notice === 'start';
      try {
        await sendMail(env, {
          to: loan.professional_email,
          subject: isStart ? 'Confirmation de votre emprunt de livres et albums' : 'Rappel : retour de vos séries dans 3 jours',
          text: isStart
            ? `Bonjour ${loan.first_name} ${loan.name},\n\nVotre emprunt commence aujourd’hui pour :\n${bookList}\n\nLe retour est prévu le ${formatDate(loan.return_date)}.\n\nMédiathèque`
            : `Bonjour ${loan.first_name} ${loan.name},\n\nNous vous rappelons que le retour prévu pour :\n${bookList}\nest le ${formatDate(loan.return_date)}.\n\nMédiathèque`,
        });
        const marker = isStart ? { Confirmation_Envoyee: today } : { Rappel_Envoye: today };
        await gristRequest(env, bookLoansTable(env), {
          method: 'PATCH',
          body: JSON.stringify({ records: group.records.map((record) => ({ id: record.id, fields: marker })) }),
        });
        console.log(`${isStart ? 'Confirmation' : 'Rappel'} envoyé pour ${loan.professional_email} (${loan.return_date}).`);
      } catch (error) {
        console.error(`Échec du courriel pour ${loan.professional_email} :`, error.message);
      }
    }
  }
}

export default {
  scheduled(controller, env, context) {
    context.waitUntil(sendReminders(env, new Date(controller.scheduledTime)));
  },
};
