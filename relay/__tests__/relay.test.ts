/**
 * @jest-environment node
 */
import { webcrypto } from 'node:crypto';

import {
  FCM_CHANNEL,
  LIMITS,
  apnsPayload,
  base64url,
  handle,
  parsePush,
  providerToken,
  resetGoogleTokenCache,
  resetTokenCache,
  type RelayDeps,
  type RelayEnv,
} from '../src/relay';

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const TOKEN = 'ab'.repeat(32);

async function makeKey(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const der = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n');
  return { pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

function deps(reply: { status: number; body?: string } = { status: 200 }) {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
  const value: RelayDeps = {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { status: reply.status, text: async () => reply.body ?? '' };
    },
    subtle,
    now: () => 1_800_000_000,
  };
  return { value, calls };
}

const post = (body: unknown, extra: Partial<{ ip: string | null; contentLength: number | null }> = {}) => ({
  method: 'POST',
  path: '/v1/push',
  ip: extra.ip ?? '203.0.113.7',
  contentLength: extra.contentLength ?? null,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const push = { token: TOKEN, title: 'api is waiting for you', body: 'claude is waiting for a reply.', data: { workspace: 'w1', connection: 'srv-1' } };

let env: RelayEnv;
let publicKey: CryptoKey;
beforeEach(async () => {
  resetTokenCache();
  const key = await makeKey();
  publicKey = key.publicKey;
  env = { APNS_KEY: key.pem, APNS_KEY_ID: 'ABC123DEFG', APNS_TEAM_ID: 'TEAM123456', APNS_TOPIC: 'dev.herdr.HerdrChat' };
});

describe('request shape', () => {
  it('accepts what the watcher sends', () => {
    expect(parsePush(push)).toEqual({ ...push, service: 'apns', env: 'production' });
  });

  it.each([
    [{ ...push, token: 'not-hex' }, 'token'],
    [{ ...push, token: 'ab' }, 'token'],
    [{ ...push, title: '' }, 'title'],
    [{ ...push, title: 'x'.repeat(LIMITS.title + 1) }, 'title'],
    [{ ...push, body: 'x'.repeat(LIMITS.body + 1) }, 'body'],
    [{ ...push, env: 'staging' }, 'env'],
    [{ ...push, sound: 'loud' }, 'Unknown field'],
    [{ ...push, data: { aps: 'x' } }, 'Unknown data field'],
    [{ ...push, data: { workspace: 3 } }, 'data.workspace'],
    [[push], 'JSON object'],
  ])('refuses %j', (input, message) => {
    expect(parsePush(input)).toEqual(expect.stringContaining(message));
  });

  // The relay shapes the payload; a caller cannot add `aps` fields or anything
  // else Apple would act on.
  it('builds the payload itself', () => {
    const parsed = parsePush(push);
    if (typeof parsed === 'string') throw new Error(parsed);
    expect(JSON.parse(apnsPayload(parsed))).toEqual({
      aps: { alert: { title: push.title, body: push.body }, sound: 'default' },
      workspace: 'w1',
      connection: 'srv-1',
    });
  });
});

describe('provider token', () => {
  it('is an ES256 JWT that verifies against the key', async () => {
    const jwt = await providerToken(env as Required<RelayEnv>, { subtle, now: () => 1_800_000_000 });
    const [header, claims, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' });
    expect(JSON.parse(Buffer.from(claims ?? '', 'base64url').toString())).toEqual({ iss: 'TEAM123456', iat: 1_800_000_000 });
    const valid = await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      Buffer.from(signature ?? '', 'base64url'),
      new TextEncoder().encode(`${header}.${claims}`)
    );
    expect(valid).toBe(true);
  });

  // APNs refuses a provider token refreshed too often.
  it('is reused for most of an hour, then renewed', async () => {
    let now = 1_800_000_000;
    const first = await providerToken(env as Required<RelayEnv>, { subtle, now: () => now });
    now += 49 * 60;
    expect(await providerToken(env as Required<RelayEnv>, { subtle, now: () => now })).toBe(first);
    now += 2 * 60;
    expect(await providerToken(env as Required<RelayEnv>, { subtle, now: () => now })).not.toBe(first);
  });

  it('encodes base64url without padding', () => {
    expect(base64url(new Uint8Array([251, 255, 191]))).toBe('-_-_');
    expect(base64url(new Uint8Array([1]))).toBe('AQ');
  });
});

describe('handler', () => {
  it('sends a valid push to production APNs with our topic', async () => {
    const { value, calls } = deps();
    const result = await handle(post(push), env, value);
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://api.push.apple.com/3/device/${TOKEN}`);
    expect(calls[0]?.init.headers).toMatchObject({
      'apns-topic': 'dev.herdr.HerdrChat',
      'apns-push-type': 'alert',
      authorization: expect.stringMatching(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/),
    });
  });

  it('uses the sandbox for development builds', async () => {
    const { value, calls } = deps();
    await handle(post({ ...push, env: 'sandbox' }), env, value);
    expect(calls[0]?.url).toContain('api.sandbox.push.apple.com');
  });

  // The watcher stops sending to a token Apple has retired.
  it("passes Apple's refusal through", async () => {
    const { value } = deps({ status: 410, body: '{"reason":"Unregistered"}' });
    expect(await handle(post(push), env, value)).toEqual({ status: 410, body: { reason: 'Unregistered' } });
  });

  it('refuses bad input without calling Apple', async () => {
    const { value, calls } = deps();
    expect((await handle(post('{nope'), env, value)).status).toBe(400);
    expect((await handle(post({ ...push, token: 'x' }), env, value)).status).toBe(400);
    expect((await handle(post(push, { contentLength: LIMITS.request + 1 }), env, value)).status).toBe(413);
    expect((await handle({ ...post(push), method: 'GET' }, env, value)).status).toBe(405);
    expect((await handle({ ...post(push), path: '/v1/other' }, env, value)).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('says so when it has no key yet', async () => {
    const { value, calls } = deps();
    const result = await handle(post(push), { APNS_TOPIC: 'dev.herdr.HerdrChat' }, value);
    expect(result).toEqual({ status: 503, body: { reason: 'RelayNotConfigured' } });
    expect(calls).toHaveLength(0);
  });

  it('limits per token and per address', async () => {
    const { value, calls } = deps();
    const deny = { limit: async () => ({ success: false }) };
    const allow = { limit: async () => ({ success: true }) };
    expect((await handle(post(push), { ...env, PER_TOKEN: deny, PER_IP: allow }, value)).status).toBe(429);
    expect((await handle(post(push), { ...env, PER_TOKEN: allow, PER_IP: deny }, value)).status).toBe(429);
    expect(calls).toHaveLength(0);
  });

  it('answers a health check with whether it is configured', async () => {
    const { value } = deps();
    expect(await handle({ method: 'GET', path: '/', ip: null, contentLength: null, body: '' }, env, value)).toEqual({
      status: 200,
      body: { service: 'herdrchat-relay', configured: true, fcm: false },
    });
  });
});

// Android: Google's push service, through the Firebase project's service account.
describe('FCM', () => {
  const FCM_TOKEN = 'cXyZ0123abcd:APA91b' + 'Ab-_9'.repeat(30);
  const androidPush = { ...push, service: 'fcm', token: FCM_TOKEN };

  async function serviceAccount() {
    const pair = (await subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    const der = Buffer.from(await subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
    const json = JSON.stringify({
      project_id: 'herdrchat-test',
      client_email: 'relay@herdrchat-test.iam.gserviceaccount.com',
      private_key: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n`,
    });
    return { json, publicKey: pair.publicKey };
  }

  /** Google's token endpoint, then FCM's reply. */
  function google(fcm: { status: number; body?: string } = { status: 200, body: '{"name":"projects/x/messages/1"}' }) {
    const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
    const value: RelayDeps = {
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (url === 'https://oauth2.googleapis.com/token') {
          return { status: 200, text: async () => '{"access_token":"ya29.test","expires_in":3599}' };
        }
        return { status: fcm.status, text: async () => fcm.body ?? '' };
      },
      subtle,
      now: () => 1_800_000_000,
    };
    return { value, calls };
  }

  beforeEach(() => resetGoogleTokenCache());

  it('accepts a registration token, and an APNs token is still checked as hex', () => {
    expect(parsePush(androidPush)).toEqual({ ...androidPush, env: 'production' });
    expect(parsePush({ ...androidPush, token: 'has spaces' })).toMatch(/token/);
    expect(parsePush({ ...push, token: FCM_TOKEN })).toMatch(/token/);
    expect(parsePush({ ...push, service: 'webpush' })).toMatch(/service/);
  });

  it('signs in as the service account and sends a data message to the token', async () => {
    const account = await serviceAccount();
    const { value, calls } = google();
    const result = await handle(post(androidPush), { ...env, FCM_SERVICE_ACCOUNT: account.json }, value);
    expect(result).toEqual({ status: 200, body: { ok: true } });

    const [exchange, send] = calls;
    const assertion = new URLSearchParams(exchange?.init.body).get('assertion') ?? '';
    const [header, claims, signature] = assertion.split('.');
    expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(claims ?? '', 'base64url').toString())).toEqual({
      iss: 'relay@herdrchat-test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    const valid = await subtle.verify(
      'RSASSA-PKCS1-v1_5',
      account.publicKey,
      Buffer.from(signature ?? '', 'base64url'),
      new TextEncoder().encode(`${header}.${claims}`)
    );
    expect(valid).toBe(true);

    expect(send?.url).toBe('https://fcm.googleapis.com/v1/projects/herdrchat-test/messages:send');
    expect(send?.init.headers.authorization).toBe('Bearer ya29.test');
    expect(JSON.parse(send?.init.body ?? '')).toEqual({
      message: {
        token: FCM_TOKEN,
        data: { title: push.title, message: push.body, channelId: FCM_CHANNEL, workspace: 'w1', connection: 'srv-1' },
        android: { priority: 'HIGH', ttl: '3600s' },
      },
    });
  });

  it('reuses its access token', async () => {
    const account = await serviceAccount();
    const { value, calls } = google();
    const withAccount = { ...env, FCM_SERVICE_ACCOUNT: account.json };
    await handle(post(androidPush), withAccount, value);
    await handle(post(androidPush), withAccount, value);
    expect(calls.filter((call) => call.url.includes('oauth2'))).toHaveLength(1);
  });

  it.each([
    ['UNREGISTERED', 404, 'Unregistered'],
    ['SENDER_ID_MISMATCH', 403, 'DeviceTokenNotForTopic'],
    ['INVALID_ARGUMENT', 400, 'INVALID_ARGUMENT'],
  ])('passes %s on in the words the watcher knows', async (code, status, reason) => {
    const account = await serviceAccount();
    const body = JSON.stringify({ error: { code: status, status: 'X', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: code }] } });
    const { value } = google({ status, body });
    expect(await handle(post(androidPush), { ...env, FCM_SERVICE_ACCOUNT: account.json }, value)).toEqual({ status, body: { reason } });
  });

  it('says so when it has no service account, and still sends to iPhones', async () => {
    const { value, calls } = deps();
    expect(await handle(post(androidPush), env, value)).toEqual({ status: 503, body: { reason: 'RelayNotConfigured' } });
    expect(calls).toHaveLength(0);
    expect((await handle(post(push), env, value)).status).toBe(200);
  });
});
