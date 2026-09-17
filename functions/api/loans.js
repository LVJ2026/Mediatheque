import { assertConfigured, gristRequest, normalizeLoan } from '../_grist.js';

export async function onRequestGet({ env }) {
  try {
    assertConfigured(env);
    const payload = await gristRequest(env, env.GRIST_LOANS_TABLE || 'Table1');
    const records = (payload.records || []).filter((record) => {
      const fields = record.fields || {};
      return fields.Jeu != null && (fields.Date_Emprunt != null || fields['Date Emprunt'] != null);
    });
    return Response.json(records.map(normalizeLoan));
  } catch (error) {
    if (error.message.startsWith('Grist 404')) return Response.json([]);
    return Response.json({ detail: error.message }, { status: 503 });
  }
}
