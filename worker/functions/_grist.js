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
  if (typeof value === 'number') return new Date(value * 1000).toISOString().slice(0, 10);
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

function normalizeLoan(record) {
  const fields = record.fields || {};
  const loanDate = toDate(fields.Date_Emprunt ?? fields['Date Emprunt']);
  const actualReturnDate = fields.Retour == null || fields.Retour === '' ? null : toDate(fields.Retour);
  const cancelledDate = fields.Date_Annulation == null || fields.Date_Annulation === '' ? null : toDate(fields.Date_Annulation);
  const returnDate = cancelledDate || actualReturnDate || addDays(loanDate, 20);
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

export { addDays, assertConfigured, gristRequest, normalizeGame, normalizeLoan };
