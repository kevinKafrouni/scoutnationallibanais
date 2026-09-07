import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseConfig } from '../server/db-config.js';

test('Supabase connections verify TLS even when the URI requests weaker settings', () => {
  const config = databaseConfig({ DATABASE_URL: 'postgres://postgres.example:password@aws-0-example.pooler.supabase.com:5432/postgres?sslmode=disable&ssl=no-verify' });
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.ok(config.ssl.ca.some(cert => cert.includes('BEGIN CERTIFICATE')));
  assert.equal(new URL(config.connectionString).search, '');
  assert.equal(config.max, 5);
});
test('local PostgreSQL works without TLS; production remote connections require it', () => {
  assert.equal(databaseConfig({ DATABASE_URL: 'postgres://localhost/snl' }).ssl, undefined);
  assert.equal(databaseConfig({ DATABASE_URL: 'postgres://db.example/snl', NODE_ENV: 'production' }).ssl.rejectUnauthorized, true);
});
test('custom certificate is supported and invalid settings do not leak credentials', () => {
  const config = databaseConfig({ DATABASE_URL: 'postgres://db.example/snl', NODE_ENV: 'production', DATABASE_SSL_CA: 'line1\\nline2' });
  assert.equal(config.ssl.ca, 'line1\nline2');
  assert.throws(() => databaseConfig({ DATABASE_URL: 'https://supabase.com/dashboard/project/example' }), /PostgreSQL/);
  assert.throws(() => databaseConfig({ DATABASE_URL: 'a-secret-not-a-uri' }), error => !error.message.includes('a-secret-not-a-uri'));
  assert.throws(() => databaseConfig({ DATABASE_URL: 'postgres://localhost/snl', DATABASE_POOL_MAX: '0' }), /DATABASE_POOL_MAX/);
});
