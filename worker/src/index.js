export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const origin = new URL(env.ORIGIN_URL);
    origin.pathname = incoming.pathname;
    origin.search = incoming.search;
    const forwarded = new Request(origin, request);
    const response = await fetch(forwarded);
    const headers = new Headers(response.headers);
    headers.set('X-Mediatheque-Edge', 'cloudflare-worker');
    return new Response(response.body, { status: response.status, headers });
  },
};
