import { db } from '../../server/db.js';
export async function handler(event, context) {
  context.callbackWaitsForEmptyEventLoop = false;
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  await db.query('DELETE FROM rate_limits WHERE expires_at < now()');
  return { statusCode: 200, body: 'Expired sessions and rate limits removed.' };
}
