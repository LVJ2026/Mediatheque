import { managerToken, SESSION_COOKIE } from '../../_manager.js';

export async function onRequestPost({ request, env }) {
  if (!env.MANAGER_PASSWORD) return Response.json({ detail: 'Le mot de passe gestionnaire n’est pas configuré.' }, { status: 503 });
  const input = await request.json().catch(() => ({}));
  if (!input.password || input.password !== env.MANAGER_PASSWORD) return Response.json({ detail: 'Mot de passe incorrect.' }, { status: 401 });
  return Response.json({ ok: true }, { headers: {
    'Set-Cookie': `${SESSION_COOKIE}=${await managerToken(env)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`,
  }});
}