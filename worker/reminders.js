import { assertConfigured, gristRequest, normalizeBookLoan, normalizeLoan } from './functions/_grist.js';
import { bookLoansTable, booksTable, isActiveBookLoan } from './functions/_books.js';
import { digitalInventoryTable, digitalLoansTable, normalizeDigitalLoan } from './functions/_digital.js';
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
  const [digitalInventory, digitalPayload] = await Promise.all([
    gristRequest(env, digitalInventoryTable(env)),
    gristRequest(env, digitalLoansTable(env)),
  ]);
  const groups = new Map();
  const bookStarts = new Map();
  const bookReturns = new Map();
  const digitalReturns = new Map();
  const overdueGames = new Map();
  const overdueBooks = new Map();
  const gameConfirmations = new Map();
  const bookConfirmations = new Map();

  for (const record of payload.records || []) {
    const fields = record.fields || {};
    const loanDate = fields.Date_Emprunt ?? fields['Date Emprunt'];
    if (fields.Jeu == null || !hasDate(loanDate)) continue;
    if (hasDate(fields.Retour) || hasDate(fields.Date_Annulation)) continue;

    const loan = normalizeLoan(record);
    const key = reminderKey(loan);
    if (hasDate(fields.Confirmation_Demandee) && !hasDate(fields.Confirmation_Envoyee)) {
      if (!gameConfirmations.has(key)) {
        gameConfirmations.set(key, { borrower: loan, records: [], gameIds: new Set() });
      }
      const confirmation = gameConfirmations.get(key);
      confirmation.records.push(record);
      confirmation.gameIds.add(loan.game_id);
    }
    if (loan.return_date < today) {
      if (!overdueGames.has(key)) {
        overdueGames.set(key, { borrower: loan, records: [], gameIds: new Set(), alreadySent: false });
      }
      const overdue = overdueGames.get(key);
      overdue.records.push(record);
      overdue.gameIds.add(loan.game_id);
      overdue.alreadySent ||= hasDate(fields.Retard_Notification_Envoyee);
    }
    if (loan.return_date !== reminderDate) continue;
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
    if (hasDate(fields.Confirmation_Demandee) && !hasDate(fields.Confirmation_Envoyee)) {
      if (!bookConfirmations.has(key)) {
        bookConfirmations.set(key, { borrower: loan, records: [], quantities: new Map() });
      }
      const confirmation = bookConfirmations.get(key);
      confirmation.records.push(record);
      confirmation.quantities.set(loan.book_id, (confirmation.quantities.get(loan.book_id) || 0) + loan.quantity);
    }
    if (loan.loan_date === today && !hasDate(fields.Confirmation_Envoyee)
      && !hasDate(fields.Confirmation_Demandee)) {
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
    if (loan.return_date < today) {
      if (!overdueBooks.has(key)) {
        overdueBooks.set(key, { borrower: loan, records: [], quantities: new Map(), alreadySent: false });
      }
      const overdue = overdueBooks.get(key);
      overdue.records.push(record);
      overdue.quantities.set(loan.book_id, (overdue.quantities.get(loan.book_id) || 0) + loan.quantity);
      overdue.alreadySent ||= hasDate(fields.Retard_Notification_Envoyee);
    }
  }

  const dueGroups = [...groups.values()].filter((group) => !group.alreadySent);
  const dueBookGroups = [...bookConfirmations.values()].map((group) => ({ ...group, notice: 'confirmation' }))
    .concat([...bookStarts.values()].map((group) => ({ ...group, notice: 'start' })))
    .concat([...bookReturns.values()].map((group) => ({ ...group, notice: 'return' })));
  for (const record of digitalPayload.records || []) {
    const fields = record.fields || {};
    if (!(fields.Validee === true || fields.Validee === 1) || hasDate(fields.Retour) || hasDate(fields.Date_Annulation)) continue;
    const loan = normalizeDigitalLoan(record, digitalInventory.records || []);
    if (loan.return_date !== reminderDate) continue;
    const key = reminderKey(loan);
    if (!digitalReturns.has(key)) {
      digitalReturns.set(key, { borrower: loan, records: [], quantities: new Map(), alreadySent: false });
    }
    const group = digitalReturns.get(key);
    group.records.push(record);
    group.quantities.set(loan.equipment_id, (group.quantities.get(loan.equipment_id) || 0) + loan.quantity);
    group.alreadySent ||= hasDate(fields.Rappel_Envoye);
  }
  const dueDigitalGroups = [...digitalReturns.values()].filter((group) => !group.alreadySent);
  const dueOverdueGames = [...overdueGames.values()].filter((group) => !group.alreadySent);
  const dueOverdueBooks = [...overdueBooks.values()].filter((group) => !group.alreadySent);
  if (!dueGroups.length && !dueBookGroups.length && !dueDigitalGroups.length
    && !dueOverdueGames.length && !dueOverdueBooks.length
    && !gameConfirmations.size && !bookConfirmations.size) return;

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

  for (const group of gameConfirmations.values()) {
    const loan = group.borrower;
    const gameList = [...group.gameIds].map((id) => `- ${gamesById.get(id) || `Jeu ${id}`}`).join('\n');
    try {
      await sendMail(env, {
        to: loan.professional_email,
        subject: 'Confirmation de votre réservation',
        text: `Bonjour ${loan.first_name} ${loan.name},\n\nVotre réservation est confirmée pour :\n${gameList}\n\nDu ${formatDate(loan.loan_date)} au ${formatDate(loan.return_date)}.`,
      });
      await gristRequest(env, table, {
        method: 'PATCH',
        body: JSON.stringify({
          records: group.records.map((record) => ({
            id: record.id,
            fields: { Confirmation_Envoyee: today },
          })),
        }),
      });
      console.log(`Confirmation de réservation envoyée pour ${loan.professional_email}.`);
    } catch (error) {
      console.error(`Échec de la confirmation de réservation pour ${loan.professional_email} :`, error.message);
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
      const isReturn = group.notice === 'return';
      try {
        await sendMail(env, {
          to: loan.professional_email,
          subject: isReturn ? 'Rappel : retour de vos séries dans 3 jours' : 'Confirmation de votre réservation de livres et albums',
          text: isReturn
            ? `Bonjour ${loan.first_name} ${loan.name},\n\nNous vous rappelons que le retour prévu pour :\n${bookList}\nest le ${formatDate(loan.return_date)}.\n\nMédiathèque`
            : isStart
              ? `Bonjour ${loan.first_name} ${loan.name},\n\nVotre emprunt commence aujourd’hui pour :\n${bookList}\n\nLe retour est prévu le ${formatDate(loan.return_date)}.\n\nMédiathèque`
              : `Bonjour ${loan.first_name} ${loan.name},\n\nVotre réservation est confirmée pour :\n${bookList}\n\nDu ${formatDate(loan.loan_date)} au ${formatDate(loan.return_date)}.\n\nMédiathèque`,
        });
        const marker = isReturn ? { Rappel_Envoye: today } : { Confirmation_Envoyee: today };
        await gristRequest(env, bookLoansTable(env), {
          method: 'PATCH',
          body: JSON.stringify({ records: group.records.map((record) => ({ id: record.id, fields: marker })) }),
        });
        console.log(`${isReturn ? 'Rappel' : 'Confirmation'} envoyé pour ${loan.professional_email} (${loan.return_date}).`);
      } catch (error) {
        console.error(`Échec du courriel pour ${loan.professional_email} :`, error.message);
      }

    }
  }

  if (dueOverdueGames.length || dueOverdueBooks.length) {
    const managerEmails = [...new Set([env.MANAGER_EMAIL1, env.MANAGER_EMAIL2]
      .map((email) => typeof email === 'string' ? email.trim() : '')
      .filter(Boolean))];
    if (!managerEmails.length) {
      console.error('Alertes de retard non envoyées : aucune adresse MANAGER_EMAIL1 ou MANAGER_EMAIL2 n’est configurée.');
    } else {
      const interfaceUrl = new URL('/#home', env.MANAGER_INTERFACE_URL || 'https://mediatheque-reservations.pages.dev').href;
      const booksById = new Map((bookInventory.records || []).map((record) => [
        Number(record.id), record.fields?.Titre || `Série ${record.id}`,
      ]));
      const gameAlerts = dueOverdueGames.map((group) => ({
        group,
        table,
        resourceLines: [...group.gameIds].map((id) => `- ${gamesById.get(id) || `Jeu ${id}`}`),
        collection: 'jeux',
      }));
      const bookAlerts = dueOverdueBooks.map((group) => ({
        group,
        table: bookLoansTable(env),
        resourceLines: [...group.quantities].map(([id, quantity]) => `- ${booksById.get(id) || `Série ${id}`} × ${quantity}`),
        collection: 'livres / albums',
      }));
      for (const { group, table: loanTable, resourceLines, collection } of [...gameAlerts, ...bookAlerts]) {
        const loan = group.borrower;
        const text = `Une réservation de ${collection} est en retard.\n\nEmprunteur : ${loan.first_name} ${loan.name}\nÉcole : ${loan.school}\nCourriel : ${loan.professional_email}\nRéservation :\n${resourceLines.join('\n')}\nDate de retour prévue : ${formatDate(loan.return_date)}\n\nOuvrir l’interface de gestion : ${interfaceUrl}`;
        let allSent = true;
        for (const to of managerEmails) {
          try {
            await sendMail(env, {
              to,
              subject: `Retard de retour – réservation de ${collection}`,
              text,
            });
          } catch (error) {
            allSent = false;
            console.error(`Échec de l’alerte de retard pour ${to} (${loan.professional_email}) :`, error.message);
          }
        }
        if (!allSent) continue;
        try {
          await gristRequest(env, loanTable, {
            method: 'PATCH',
            body: JSON.stringify({
              records: group.records.map((record) => ({
                id: record.id,
                fields: { Retard_Notification_Envoyee: today },
              })),
            }),
          });
          console.log(`Alerte de retard envoyée pour ${loan.professional_email} (${loan.return_date}).`);
        } catch (error) {
          console.error(`Alerte envoyée, mais suivi Grist impossible pour ${loan.professional_email} :`, error.message);
        }
      }
    }
  }

  if (dueDigitalGroups.length) {
    const equipmentById = new Map((digitalInventory.records || []).map((record) => [
      Number(record.id), record.fields?.Equipement || `Équipement ${record.id}`,
    ]));
    for (const group of dueDigitalGroups) {
      const loan = group.borrower;
      const equipmentList = [...group.quantities]
        .map(([id, quantity]) => `- ${equipmentById.get(id) || `Équipement ${id}`} × ${quantity}`)
        .join('\n');
      try {
        await sendMail(env, {
          to: loan.professional_email,
          subject: 'Rappel : retour de votre matériel numérique dans 3 jours',
          text: `Bonjour ${loan.first_name} ${loan.name},\n\nNous vous rappelons que le retour prévu pour :\n${equipmentList}\nest le ${formatDate(loan.return_date)}.\n\nMédiathèque`,
        });
        await gristRequest(env, digitalLoansTable(env), {
          method: 'PATCH',
          body: JSON.stringify({
            records: group.records.map((record) => ({ id: record.id, fields: { Rappel_Envoye: today } })),
          }),
        });
        console.log(`Rappel numérique envoyé pour ${loan.professional_email} (${loan.return_date}).`);
      } catch (error) {
        console.error(`Échec du courriel numérique pour ${loan.professional_email} :`, error.message);
      }
    }
  }
}

export default {
  scheduled(controller, env, context) {
    context.waitUntil(sendReminders(env, new Date(controller.scheduledTime)));
  },
};
