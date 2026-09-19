import { SESSION_COOKIE } from '../../_manager.js';

export async function onRequestPost() {
  return Response.json({ ok: true }, { headers: {
    'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
  }});
}