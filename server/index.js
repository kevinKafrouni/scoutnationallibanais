import { db } from './db.js';
import { createApp } from './app.js';
import { migrate } from './migrate.js';
const production = process.env.NODE_ENV === 'production';
if (production && !process.env.APP_ORIGIN) throw new Error('APP_ORIGIN is required in production.');
await migrate(db, process.env.ADMIN_PASSWORD);
const app = createApp(db, { production, origin: process.env.APP_ORIGIN || 'http://localhost:3000', trustProxy: Number(process.env.TRUST_PROXY || 0) });
const server = app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Registry server is ready.'));
const cleanup = setInterval(() => {
  db.query('DELETE FROM sessions WHERE expires_at < now()').catch(() => console.error('Session cleanup failed.'));
  db.query('DELETE FROM rate_limits WHERE expires_at < now()').catch(() => console.error('Rate limit cleanup failed.'));
}, 15 * 60 * 1000);
cleanup.unref();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  clearInterval(cleanup);
  server.close(async () => { await db.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
});
