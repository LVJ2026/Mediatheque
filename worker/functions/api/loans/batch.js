import { addDays, assertConfigured, gristRequest, normalizeLoan } from '../../_grist.js';

export async function onRequestPost({ request, env }) {
  try {
    assertConfigured(env);
    const input = await request.json();
    if (!input.name || !input.first_name || !input.professional_email || !input.school || !input.loan_date || !Array.isArray(input.game_ids) || input.game_ids.length === 0) {
      return Response.json({ detail: 'Tous les champs et au moins un jeu sont obligatoires.' }, { status: 422 });
    }

    const loansPayload = await gristRequest(env, env.GRIST_LOANS_TABLE || 'Table1');
    const existing = (loansPayload.records || []).map(normalizeLoan);
    const requestedEnd = addDays(input.loan_date, 20);
    const conflict = input.game_ids.some((gameId) => existing.some((loan) => loan.game_id === Number(gameId) && input.loan_date <= loan.return_date && requestedEnd >= loan.loan_date));
    if (conflict) return Response.json({ detail: 'Au moins un jeu est déjà réservé sur cette période.' }, { status: 409 });

    const returnDate = requestedEnd;
    const records = input.game_ids.map((gameId) => ({ fields: {
      Nom: input.name,
      Prenom: input.first_name,
      Mail_professionnel: input.professional_email,
      Ecole: input.school,
      Date_Emprunt: input.loan_date,
      Retour: returnDate,
      Jeu: Number(gameId),
    }}));
    const created = await gristRequest(env, env.GRIST_LOANS_TABLE || 'Table1', {
      method: 'POST',
      body: JSON.stringify({ records }),
    });
    return Response.json((created.records || []).map((record) => normalizeLoan(record)), { status: 201 });
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
