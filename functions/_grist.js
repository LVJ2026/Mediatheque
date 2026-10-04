const DAY_MS = 24 * 60 * 60 * 1000;

function gristUrl(env, table) {
  const root = new URL(env.GRIST_BASE_URL || 'https://grist.numerique.gouv.fr').origin;
  const tableId = table.replaceAll(' ', '_');
  return `${root}/api/docs/${env.GRIST_DOC_ID}/tables/${tableId}/records`;
}

async function gristRequest(env, table, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${env.GRIST_API_KEY}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(gristUrl(env, table), { ...init, headers });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Grist ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json();
}

function assertConfigured(env) {
  if (!env.GRIST_API_KEY || !env.GRIST_DOC_ID || env.GRIST_ENABLED !== 'true') {
    throw new Error('Grist est mal configuree. Renseignez GRIST_API_KEY, GRIST_DOC_ID et GRIST_ENABLED=true.');
  }
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

function addDays(value, amount) {
  return new Date(new Date(`${value}T12:00:00`).getTime() + amount * DAY_MS).toISOString().slice(0, 10);
}

function normalizeGame(record) {
  const fields = record.fields || {};
  return {
    id: record.id,
    Jeu: fields.Jeu || '',
    Marque: fields.Marque ?? '',
    'Âge indiqué': fields['Âge indiqué'] ?? fields.Age_indique ?? '',
    Joueurs: fields.Joueurs ?? '',
    Remarques: fields.Remarques ?? '',
  };
}

function normalizeBook(record) {
  const fields = record.fields || {};
  const quantity = Number(fields.Quantite ?? fields['Quantité'] ?? 0);
  return {
    id: record.id,
    Titre: fields.Titre || '',
    Auteur: fields.Auteur ?? '',
    Lieu: fields.Lieu ?? '',
    quantity,
    available_quantity: quantity,
  };
}

function normalizeLoan(record) {
  const fields = record.fields || {};
  const loanDate = toDate(fields.Date_Emprunt ?? fields['Date Emprunt']);
  const actualReturnDate = fields.Retour == null || fields.Retour === '' ? null : toDate(fields.Retour);
  const cancelledDate = fields.Date_Annulation == null || fields.Date_Annulation === '' ? null : toDate(fields.Date_Annulation);
  const plannedEndDate = fields.Date_Fin == null || fields.Date_Fin === '' ? addDays(loanDate, 20) : toDate(fields.Date_Fin);
  const returnDate = cancelledDate || actualReturnDate || plannedEndDate;
  const occupiedUntil = cancelledDate || actualReturnDate ? addDays(returnDate, -1) : returnDate;
  return {
    id: record.id,
    name: fields.Nom || '',
    first_name: fields.Prenom || fields['Prénom'] || '',
    professional_email: fields.Mail_professionnel || fields['Mail professionnel'] || '',
    school: fields.Ecole || '',
    loan_date: loanDate,
    game_id: Number(fields.Jeu),
    return_date: returnDate,
    occupied_until: occupiedUntil,
    cancelled_date: cancelledDate,
  };
}

function normalizeBookLoan(record, inventoryRecords = []) {
  const fields = record.fields || {};
  const key = [fields.Titre, fields.Auteur, fields.Lieu].map((value) => String(value ?? '').trim()).join('\u001f');
  const book = inventoryRecords.find((item) => {
    const bookFields = item.fields || {};
    return [bookFields.Titre, bookFields.Auteur, bookFields.Lieu]
      .map((value) => String(value ?? '').trim()).join('\u001f') === key;
  });
  return {
    ...normalizeLoan(record),
    game_id: null,
    book_id: Number(book?.id),
    quantity: Number(fields.Quantite ?? fields['Quantité'] ?? 1),
    Titre: fields.Titre || '',
    Auteur: fields.Auteur ?? '',
    Lieu: fields.Lieu ?? '',
    is_active: (fields.Retour == null || fields.Retour === '')
      && (fields.Date_Annulation == null || fields.Date_Annulation === ''),
    collection: 'books',
  };
}

export { addDays, assertConfigured, gristRequest, normalizeBook, normalizeBookLoan, normalizeGame, normalizeLoan };
