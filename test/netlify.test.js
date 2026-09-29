import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { testDatabase } from './support/database.js';
import { migrate } from '../server/migrate.js';
import { createNetlifyHandler } from '../server/netlify-handler.js';

test('deployed origin defaults survive local configuration and still reject foreign origins', async () => {
  const db = { query: async () => ({ rows: [{ members: 0, unused: 0 }] }) };
  for (const APP_ORIGIN of [undefined, 'http://localhost:3000', 'http://scoutnationallibanais.org']) {
    const handler = createNetlifyHandler(db, { APP_ORIGIN, URL: 'https://assigned-site.netlify.app' });
    const call = (path, origin, method = 'POST') => handler({
      path, httpMethod: method, headers: { origin, 'content-type': 'application/json' },
      body: method === 'POST' ? '{}' : null,
    }, {});
    assert.equal((await call('/api/state', undefined, 'GET')).statusCode, 200);
    const logout = await call('/api/logout', 'https://scoutnationallibanais.org');
    assert.equal(logout.statusCode, 200);
    assert.match(JSON.stringify(logout), /Secure/);
    assert.equal((await call('/api/logout', 'https://untrusted.example')).statusCode, 403);
    assert.equal((await call('/api/logout', 'http://localhost:3000')).statusCode, 403);
  }
  const local = createNetlifyHandler(db, { NETLIFY_DEV: 'true', APP_ORIGIN: 'http://localhost:8888' });
  assert.equal((await local({ path: '/api/logout', httpMethod: 'POST', headers: {
    origin: 'http://localhost:8888', 'content-type': 'application/json',
  }, body: '{}' }, {})).statusCode, 200);
});

test('Netlify function routing, secure sessions, registration, QR and origin protection', async () => {
  const engine = new PGlite();
  const db = testDatabase(engine);
  const password = 'netlify-test-password';
  try {
    await migrate(db, password);
    const origin = 'https://registry-test.netlify.app';
    const handler = createNetlifyHandler(db, { APP_ORIGIN: origin });
    const call = (path, body, cookie, headers = {}) => handler({
      path, httpMethod: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : null,
      headers: { host: 'registry-test.netlify.app', origin, 'content-type': 'application/json', 'x-nf-client-connection-ip': '203.0.113.5', ...(cookie ? { cookie } : {}), ...headers },
      queryStringParameters: {}, isBase64Encoded: false,
      requestContext: { identity: { sourceIp: '127.0.0.1' } },
    }, {});
    assert.equal((await call('/.netlify/functions/api/healthz')).statusCode, 200);
    assert.equal((await call('/api/state')).statusCode, 200);
    assert.equal((await call('/.netlify/functions/api/state')).statusCode, 200);
    assert.equal((await call('/.env')).statusCode, 404);
    assert.equal((await call('/api/login', { type: 'admin', password }, null, { origin: 'https://untrusted.example' })).statusCode, 403);
    const login = await call('/api/login', { type: 'admin', password });
    assert.equal(login.statusCode, 200);
    const setCookie = login.multiValueHeaders?.['set-cookie']?.[0] || login.headers['set-cookie'];
    assert.match(setCookie, /__Host-snl-session=/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /HttpOnly/);
    const adminCookie = setCookie.split(';')[0];
    assert.equal((await call('/api/codes', { quantity: 1 }, adminCookie)).statusCode, 201);
    const state = JSON.parse((await call('/api/state', undefined, adminCookie)).body);
    const registered = await call('/api/register', { firstName: 'Function', lastName: 'Test', dateOfBirth: '2000-01-01', bloodType: 'O+', accessCode: state.codes[0].code, password });
    assert.equal(registered.statusCode, 201);
    const memberCookie = (registered.multiValueHeaders?.['set-cookie']?.[0] || registered.headers['set-cookie']).split(';')[0];
    const qr = await call('/api/card/qr', undefined, memberCookie);
    assert.equal(qr.statusCode, 200);
    assert.equal(qr.isBase64Encoded, true);
    assert.equal(Buffer.from(qr.body, 'base64').subarray(1, 4).toString(), 'PNG');
    // Fresh function instance still reads the database session.
    const secondHandler = createNetlifyHandler(db, { APP_ORIGIN: origin });
    const persisted = await secondHandler({ path: '/api/state', httpMethod: 'GET', headers: { cookie: memberCookie }, body: null, requestContext: { identity: { sourceIp: '127.0.0.1' } } }, {});
    assert.equal(JSON.parse(persisted.body).session.type, 'member');
    assert.equal((await call('/api/logout', {}, memberCookie)).statusCode, 200);
    assert.equal(JSON.parse((await call('/api/state', undefined, memberCookie)).body).session.type, null);
  } finally { await engine.close(); }
});
