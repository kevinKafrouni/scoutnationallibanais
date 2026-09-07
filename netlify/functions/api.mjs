import { db } from '../../server/db.js';
import { createNetlifyHandler } from '../../server/netlify-handler.js';
// Reuse a small pool across warm invocations. No migrations or listening server here.
export const handler = createNetlifyHandler(db);
