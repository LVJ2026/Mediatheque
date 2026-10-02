import { addDays, assertConfigured, gristRequest, normalizeLoan } from '../../_grist.js';

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function onRequestPost({ request, env }) {
  try {
    assertConfigured(env);
    const input = await request.json();
    if (!input.name || !input.first_name || !input.professional_email || !input.school || !isValidDate(input.loan_date) || !isValidDate(input.end_date) || input.end_date < input.loan_date || !Array.isArray(input.game_ids) || input.game_ids.length === 0) {
      return Response.json({ detail: 'Tous les champs sont obligatoires et les dates doivent former une période valide.' }, { status: 422 });
    }

    const loansPayload = await gristRequest(env, env.GRIST_LOANS_TABLE || 'Emprunts');
    const existing = (loansPayload.records || []).map(normalizeLoan);
    const requestedEnd = input.end_date;
    const conflict = input.game_ids.some((gameId) => existing.some((loan) => loan.game_id === Number(gameId) && input.loan_date <= (loan.occupied_until || loan.return_date) && requestedEnd >= loan.loan_date));
    if (conflict) return Response.json({ detail: 'Au moins un jeu est déjà réservé sur cette période.' }, { status: 409 });

    const records = input.game_ids.map((gameId) => ({ fields: {
      Nom: input.name,
      Prenom: input.first_name,
      Mail_professionnel: input.professional_email,
      Ecole: input.school,
      Date_Emprunt: input.loan_date,
      Date_Fin: input.end_date,
      Jeu: Number(gameId),
    }}));
    const created = await gristRequest(env, env.GRIST_LOANS_TABLE || 'Emprunts', {
      method: 'POST',
      body: JSON.stringify({ records }),
    });
    const loans = input.game_ids.map((gameId, index) => normalizeLoan({
      id: created.records?.[index]?.id,
      fields: records[index].fields,
    }));
    return Response.json(loans, { status: 201 });
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
