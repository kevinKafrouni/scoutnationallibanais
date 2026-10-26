import { siteConfig } from './site-config.js';

export async function submitContact(message) {
  if (!siteConfig.contactEndpoint) {
    throw new Error('Message not sent. Online contact delivery is not available yet. Please try again once contact details are published.');
  }
  const response = await fetch(siteConfig.contactEndpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message), signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) throw new Error('Your message could not be sent. Please try again later.');
}
