import { siteConfig as config } from './site-config.js';
import { submitContact } from './contact-service.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const paths = {
  mountain: '<path d="m2 20 7-14 5 9 3-6 5 11H2Z"/><path d="m6 12 3 2 2-2"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M17 4a3 3 0 0 1 0 6m2 4a6 6 0 0 1 3 5v2"/>',
  heart: '<path d="M20 5c-3-3-7-1-8 1-1-2-5-4-8-1-5 5 3 11 8 15 5-4 13-10 8-15Z"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16 8-2 6-6 2 2-6 6-2Z"/>',
  leaf: '<path d="M20 3C5 2 1 11 7 17s15 2 13-14ZM4 21 16 9"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.compass}</svg>`;
const links = [{ href: '/', label: 'Home' }, { href: '/contact', label: 'Contact Us' }, { href: '/portal.html', label: 'Login / Register' }];
const current = location.pathname === '/index.html' ? '/' : location.pathname.replace(/\/$/, '') || '/';
const nav = () => links.map(link => `<a href="${link.href}" ${current === link.href ? 'aria-current="page"' : ''} class="${link.href === '/portal.html' ? 'nav-primary' : ''}">${link.label}</a>`).join('');
const brand = `<a class="site-brand" href="/" aria-label="${escape(config.organizationName)} home"><img src="/snl-logo.jpeg" width="60" height="60" alt=""><span>${escape(config.organizationName)}</span></a>`;
const header = document.querySelector('[data-site-header]');
header.className = 'site-header';
header.innerHTML = `<div class="site-container nav-inner">${brand}<button class="menu-toggle" type="button" aria-expanded="false" aria-controls="siteNav" aria-label="Open navigation"><span aria-hidden="true">☰</span> Menu</button><nav id="siteNav" aria-label="Main navigation">${nav()}</nav></div>`;
const toggle = header.querySelector('.menu-toggle');
const setMenu = open => {
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  header.classList.toggle('menu-open', open);
};
toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
header.addEventListener('keydown', event => {
  if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { setMenu(false); toggle.focus(); }
});
header.querySelector('nav').addEventListener('click', event => { if (event.target.closest('a')) setMenu(false); });
matchMedia('(min-width: 761px)').addEventListener('change', () => setMenu(false));
const footer = document.querySelector('[data-site-footer]');
footer.className = 'site-footer';
footer.innerHTML = `<div class="site-container"><div class="footer-top">${brand}<nav aria-label="Footer navigation">${nav()}</nav></div><p>© ${new Date().getFullYear()} ${escape(config.organizationName)}. All rights reserved.</p></div>`;
for (const [selector, items, branch] of [['[data-values]', config.values, false], ['[data-branches]', config.branches, true]]) {
  const target = document.querySelector(selector);
  if (target) target.innerHTML = items.map(item => `<article class="${branch ? 'branch-card' : 'value-card'}"><div class="card-icon">${icon(item.icon)}</div><h3>${escape(item.name)}</h3>${branch ? `<p class="age-range">${escape(item.ages)}</p>` : ''}<p>${escape(item.description)}</p></article>`).join('');
}
const hero = document.querySelector('[data-hero-title]');
if (hero) {
  hero.replaceChildren(...config.hero.title.flatMap((line, index) => index ? [document.createElement('br'), document.createTextNode(line)] : [document.createTextNode(line)]));
  document.querySelector('[data-hero-subtitle]').textContent = config.hero.subtitle;
  const photo = document.querySelector('[data-hero-image]');
  photo.src = config.hero.image; photo.alt = config.hero.imageAlt;
}
const form = document.querySelector('#contactForm');
if (form) {
  document.querySelector('[data-contact-details]').innerHTML = Object.entries(config.contact).map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value || 'To be announced')}</dd></div>`).join('');
  document.querySelector('[data-social-links]').innerHTML = Object.entries(config.social).filter(([, url]) => /^https:\/\//.test(url)).map(([name, url]) => `<a href="${escape(url)}">${escape(name)}</a>`).join(' ');
  document.querySelector('#contactAvailability').textContent = config.contactEndpoint ? '' : 'Online message delivery is not available yet. Contact details will be published here when available.';
  const validate = input => {
    const error = document.getElementById(`${input.name}Error`);
    if (!error) return true;
    const invalid = !input.value.trim() || !input.validity.valid;
    input.setAttribute('aria-invalid', String(invalid));
    error.textContent = invalid ? (input.validity.typeMismatch ? 'Enter a valid email address.' : 'Please complete this field.') : '';
    return !invalid;
  };
  form.addEventListener('input', event => { if (event.target.getAttribute('aria-invalid') === 'true') validate(event.target); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.querySelector('#contactStatus');
    status.textContent = '';
    const invalid = [...form.querySelectorAll('[required]')].filter(input => !validate(input));
    if (invalid.length) { invalid[0].focus(); return; }
    const button = form.querySelector('button');
    button.disabled = true; button.textContent = 'Sending…'; form.setAttribute('aria-busy', 'true');
    try {
      await submitContact(Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, value.trim()])));
      status.textContent = 'Thank you. Your message has been sent.'; status.className = 'success'; form.reset();
    } catch (error) {
      status.textContent = error.name === 'TimeoutError' ? 'The request timed out. Please try again.' : error.message;
      status.className = 'error';
    } finally {
      button.disabled = false; button.textContent = 'Send Message'; form.removeAttribute('aria-busy'); status.focus();
    }
  });
}
