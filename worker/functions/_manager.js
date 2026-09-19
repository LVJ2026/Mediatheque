const SESSION_COOKIE = 'mediatheque_manager';

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function managerToken(env) {
  return digest(`${env.MANAGER_PASSWORD}:mediatheque-manager-v1`);
}

function readCookie(request, name) {
  const cookies = request.headers.get('Cookie') || '';
  return cookies.split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function isManager(request, env) {
  if (!env.MANAGER_PASSWORD) return false;
  return readCookie(request, SESSION_COOKIE) === await managerToken(env);
}

function unauthorized() {
  return Response.json({ detail: 'Accès gestionnaire requis.' }, { status: 401 });
}

export { SESSION_COOKIE, isManager, managerToken, unauthorized };
