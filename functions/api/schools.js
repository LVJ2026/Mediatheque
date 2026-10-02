import { assertConfigured, gristRequest } from '../_grist.js';

export async function onRequestGet({ env }) {
  try {
    assertConfigured(env);
    const payload = await gristRequest(env, env.GRIST_SCHOOLS_TABLE || 'Ecoles');
    const schools = (payload.records || []).map(({ fields = {} }) => (
      fields.Ecole ?? fields['École'] ?? fields.Nom ?? fields['Nom de l’école'] ?? ''
    )).map((school) => String(school).trim()).filter(Boolean);
    return Response.json([...new Set(schools)].sort((left, right) => left.localeCompare(right, 'fr')));
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}