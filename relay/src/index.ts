import { handle, type RelayEnv } from './relay';

/**
 * The Workers entry point: adapt a `Request` to the relay's plain inputs and
 * back. Everything that decides anything is in `relay.ts`.
 */
export default {
  async fetch(request: Request, env: RelayEnv): Promise<Response> {
    const url = new URL(request.url);
    const length = request.headers.get('content-length');
    const result = await handle(
      {
        method: request.method,
        path: url.pathname,
        ip: request.headers.get('cf-connecting-ip'),
        contentLength: length === null ? null : Number(length),
        body: request.method === 'POST' ? await request.text() : '',
      },
      env,
      {
        fetch: (target, init) => fetch(target, init),
        subtle: crypto.subtle,
        now: () => Math.floor(Date.now() / 1000),
      }
    );
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  },
};
