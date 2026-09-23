/**
 * HerdrChat's push relay.
 *
 * Apple only accepts a push signed with the APNs key of the team that built the
 * app. The App Store build is ours, so a watcher on someone's own machine had no
 * key it could use and notifications could not work for anyone who installed
 * the app from the store (#95). The relay holds that key and does one thing: it
 * takes a narrowly shaped notification from a watcher, signs it, and hands it to
 * Apple.
 *
 * What it deliberately does not do: store anything, log anything about a
 * request, accept a payload it did not shape itself, or send to any app but
 * HerdrChat. Holding a device token is the authorisation, the same as it is
 * with Apple: tokens only ever live on the phone and on the user's own hosts.
 *
 * Kept free of Worker types so the logic is tested in Jest; `index.ts` adapts it
 * to the Workers runtime.
 */

export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RelayEnv {
  /** The `.p8` key file's contents: a PKCS#8 PEM for a P-256 key. Secret. */
  APNS_KEY?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  /** The only app the relay sends to. */
  APNS_TOPIC?: string;
  PER_TOKEN?: RateLimit;
  PER_IP?: RateLimit;
}

/** Only these ride along beside `aps`; they are what the app routes a tap by. */
const DATA_KEYS = ['workspace', 'label', 'session', 'connection'] as const;
type DataKey = (typeof DATA_KEYS)[number];

export interface PushRequest {
  token: string;
  env: 'production' | 'sandbox';
  title: string;
  body: string;
  data: Partial<Record<DataKey, string>>;
}

export interface RelayRequest {
  method: string;
  path: string;
  /** The caller's address, for the per-address limit. */
  ip: string | null;
  contentLength: number | null;
  body: string;
}

export interface RelayResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface RelayDeps {
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
    status: number;
    text(): Promise<string>;
  }>;
  subtle: SubtleCrypto;
  /** Seconds since the epoch. */
  now: () => number;
}

export const LIMITS = { title: 120, body: 240, field: 200, request: 4096 } as const;

/** APNs device tokens are hex. 32 bytes today; Apple has said they may grow. */
const TOKEN = /^[0-9a-f]{64,200}$/i;

/** Validate a watcher's request, or say what is wrong with it. */
export function parsePush(value: unknown): PushRequest | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'Expected a JSON object.';
  const input = value as Record<string, unknown>;
  const known = new Set(['token', 'env', 'title', 'body', 'data']);
  const unknown = Object.keys(input).filter((key) => !known.has(key));
  if (unknown.length > 0) return `Unknown field: ${unknown.join(', ')}.`;

  const { token, env = 'production', title, body, data = {} } = input;
  if (typeof token !== 'string' || !TOKEN.test(token)) return 'token must be an APNs device token (hex).';
  if (env !== 'production' && env !== 'sandbox') return 'env must be "production" or "sandbox".';
  if (typeof title !== 'string' || title.length === 0 || title.length > LIMITS.title) {
    return `title must be 1 to ${LIMITS.title} characters.`;
  }
  if (typeof body !== 'string' || body.length > LIMITS.body) return `body must be at most ${LIMITS.body} characters.`;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return 'data must be an object.';

  const fields: Partial<Record<DataKey, string>> = {};
  for (const [key, field] of Object.entries(data)) {
    if (!(DATA_KEYS as readonly string[]).includes(key)) return `Unknown data field: ${key}.`;
    if (typeof field !== 'string' || field.length > LIMITS.field) {
      return `data.${key} must be a string of at most ${LIMITS.field} characters.`;
    }
    fields[key as DataKey] = field;
  }
  return { token: token.toLowerCase(), env, title, body, data: fields };
}

/** The payload Apple receives. The same shape the self-hosted watcher sends. */
export function apnsPayload(push: PushRequest): string {
  return JSON.stringify({
    aps: { alert: { title: push.title, body: push.body }, sound: 'default' },
    ...push.data,
  });
}

// MARK: - Provider token

/** APNs accepts a token 20 to 60 minutes old, and rejects refreshing it too often. */
const TOKEN_LIFETIME_S = 50 * 60;
let cached: { keyId: string; issuedAt: number; jwt: string } | null = null;

/** Forget the cached token. For tests, which change the key between cases. */
export function resetTokenCache(): void {
  cached = null;
}

export async function providerToken(env: Required<Pick<RelayEnv, 'APNS_KEY' | 'APNS_KEY_ID' | 'APNS_TEAM_ID'>>, deps: Pick<RelayDeps, 'subtle' | 'now'>): Promise<string> {
  const now = deps.now();
  if (cached !== null && cached.keyId === env.APNS_KEY_ID && now - cached.issuedAt < TOKEN_LIFETIME_S) {
    return cached.jwt;
  }
  const key = await deps.subtle.importKey(
    'pkcs8',
    pemBody(env.APNS_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const header = base64url(utf8(JSON.stringify({ alg: 'ES256', kid: env.APNS_KEY_ID })));
  const claims = base64url(utf8(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: now })));
  const input = `${header}.${claims}`;
  // WebCrypto's ECDSA signature is already the raw r||s that JWS wants, unlike
  // openssl's DER, which the Python watcher has to unpack.
  const signature = await deps.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(input));
  const jwt = `${input}.${base64url(new Uint8Array(signature))}`;
  cached = { keyId: env.APNS_KEY_ID, issuedAt: now, jwt };
  return jwt;
}

// MARK: - Handler

export async function handle(request: RelayRequest, env: RelayEnv, deps: RelayDeps): Promise<RelayResponse> {
  if (request.path === '/' && request.method === 'GET') {
    return { status: 200, body: { service: 'herdrchat-relay', configured: isConfigured(env) } };
  }
  if (request.path !== '/v1/push') return { status: 404, body: { reason: 'NotFound' } };
  if (request.method !== 'POST') return { status: 405, body: { reason: 'MethodNotAllowed' } };

  if ((request.contentLength ?? 0) > LIMITS.request || utf8(request.body).length > LIMITS.request) {
    return { status: 413, body: { reason: 'PayloadTooLarge' } };
  }
  let json: unknown;
  try {
    json = JSON.parse(request.body);
  } catch {
    return { status: 400, body: { reason: 'BadRequest', message: 'Body is not JSON.' } };
  }
  const push = parsePush(json);
  if (typeof push === 'string') return { status: 400, body: { reason: 'BadRequest', message: push } };

  if (request.ip !== null && env.PER_IP !== undefined && !(await env.PER_IP.limit({ key: request.ip })).success) {
    return { status: 429, body: { reason: 'TooManyRequests' } };
  }
  if (env.PER_TOKEN !== undefined && !(await env.PER_TOKEN.limit({ key: push.token })).success) {
    return { status: 429, body: { reason: 'TooManyRequests' } };
  }

  if (!isConfigured(env)) return { status: 503, body: { reason: 'RelayNotConfigured' } };

  const jwt = await providerToken(env, deps);
  const host = push.env === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const response = await deps.fetch(`https://${host}/3/device/${push.token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': env.APNS_TOPIC ?? DEFAULT_TOPIC,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      // Undelivered after an hour, it is about a moment that has passed.
      'apns-expiration': String(deps.now() + 3600),
    },
    body: apnsPayload(push),
  });
  if (response.status === 200) return { status: 200, body: { ok: true } };
  // Apple's reason is passed through: `Unregistered` and `BadDeviceToken` tell
  // the watcher to stop sending to that token.
  return { status: response.status, body: { reason: reasonOf(await response.text()) } };
}

const DEFAULT_TOPIC = 'dev.herdr.HerdrChat';

function isConfigured(env: RelayEnv): env is RelayEnv & Required<Pick<RelayEnv, 'APNS_KEY' | 'APNS_KEY_ID' | 'APNS_TEAM_ID'>> {
  return Boolean(env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID);
}

function reasonOf(text: string): string {
  try {
    const parsed = JSON.parse(text) as { reason?: unknown };
    return typeof parsed.reason === 'string' ? parsed.reason : 'Unknown';
  } catch {
    return 'Unknown';
  }
}

// MARK: - Encoding, without Buffer (the Workers runtime has none)

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63];
    out += B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_');
}

function pemBody(pem: string): Uint8Array<ArrayBuffer> {
  const text = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    if (char === '=') break;
    const value = B64.indexOf(char);
    if (value < 0) throw new Error('APNS_KEY is not a PEM key.');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}
