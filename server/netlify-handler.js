import serverless from 'serverless-http';
import { isIP } from 'node:net';
import { createApp } from './app.js';

export function createNetlifyHandler(db, env = process.env) {
  const production = env.NETLIFY_DEV !== 'true';
  // This site's production origin is public configuration. A copied local
  // APP_ORIGIN must not prevent the deployed function from starting.
  const configuredOrigin = env.APP_ORIGIN?.trim();
  const origin = production
    ? (configuredOrigin?.startsWith('https://') ? new URL(configuredOrigin).origin : 'https://scoutnationallibanais.org')
    : configuredOrigin || env.URL;
  if (!origin) throw new Error('Set APP_ORIGIN to the Netlify site URL or your custom domain.');
  const app = createApp(db, { production, origin, serveStatic: false });
  const invoke = serverless(app, {
    binary: ['image/png'],
    request(req, event) {
      // Netlify supplies this header. Do not trust user-supplied X-Forwarded-For.
      const address = event.headers?.['x-nf-client-connection-ip'];
      if (address && isIP(address)) Object.defineProperty(req, 'ip', { value: address });
    },
  });
  return (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    // Handle both Netlify rewrite events and direct function URLs.
    let path = event.path.replace(/^\/\.netlify\/functions\/api(?=\/|$)/, '/api');
    if (path === '/api/healthz') path = '/healthz';
    return invoke({ ...event, path }, context);
  };
}
