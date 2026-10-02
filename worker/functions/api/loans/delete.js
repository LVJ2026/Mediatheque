import { isManager, unauthorized } from '../../_manager.js';

export async function onRequestPost({ request, env }) {
  if (!await isManager(request, env)) return unauthorized();
  return Response.json({ detail: 'Les annulations sont gérées localement dans le navigateur.' }, { status: 410 });
}
