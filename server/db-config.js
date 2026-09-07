import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';

export function databaseConfig(env) {
  if (!env.DATABASE_URL) throw new Error('Set DATABASE_URL in .env or your hosting environment.');
  let url;
  try { url = new URL(env.DATABASE_URL); }
  catch { throw new Error('DATABASE_URL must be a PostgreSQL connection URI.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must be a PostgreSQL connection URI, not a Supabase dashboard or API URL.');
  const supabase = url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.com');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const secure = supabase || (env.NODE_ENV === 'production' && !local);
  const max = Number(env.DATABASE_POOL_MAX || 5);
  if (!Number.isInteger(max) || max < 1 || max > 20) throw new Error('DATABASE_POOL_MAX must be an integer between 1 and 20.');
  const config = { connectionString: url.toString(), max, connectionTimeoutMillis: 10000 };
  if (secure) {
    // pg's URI SSL options override its ssl object. Remove them to enforce verification.
    for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
    config.connectionString = url.toString();
    config.ssl = { rejectUnauthorized: true };
    if (env.DATABASE_SSL_CA) config.ssl.ca = env.DATABASE_SSL_CA.replace(/\\n/g, '\n');
    else if (supabase) config.ssl.ca = [...rootCertificates, readFileSync(new URL('./certs/supabase-ca.crt', import.meta.url), 'utf8')];
  }
  return config;
}
