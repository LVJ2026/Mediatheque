import { assertConfigured, gristRequest } from '../_grist.js';

function schoolName(fields) {
  const entries = Object.entries(fields);
  const textEntries = entries.filter(([, value]) => typeof value === 'string' && value.trim());
  const normalizedKey = (key) => key.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const namedSchool = textEntries.find(([key]) => /ecole|etablissement|school/.test(normalizedKey(key)));
  const namedLabel = textEntries.find(([key]) => /nom|name|libelle|label/.test(normalizedKey(key)));
  const preferred = [fields.Ecole, fields['École'], fields.Ecoles, fields.Nom_Ecole, fields.Nom_ecole, fields['Nom de l’école'], fields["Nom de l'école"], fields.Nom].find((value) => typeof value === 'string' && value.trim());
  const value = preferred ?? namedSchool?.[1] ?? fields.A ?? namedLabel?.[1] ?? textEntries[0]?.[1] ?? '';
  return String(value).trim().replace(/^\d+\s*\|\s*/, '').replace(/\s+\S+@\S+\.[^\s]+.*$/, '').trim();
}

export async function onRequestGet({ env }) {
  try {
    assertConfigured(env);
    const payload = await gristRequest(env, env.GRIST_SCHOOLS_TABLE || 'Ecoles');
    const schools = (payload.records || []).map(({ fields = {} }) => schoolName(fields)).filter(Boolean);
    return Response.json([...new Set(schools)].sort((left, right) => left.localeCompare(right, 'fr')));
  } catch (error) {
    return Response.json({ detail: error.message }, { status: 503 });
  }
}