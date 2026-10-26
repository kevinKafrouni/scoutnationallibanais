const fail = message => Object.assign(new Error(message), { status: 400 });

export function username(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw fail('Enter a valid username.');
  const name = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,29}$/.test(name) || name === 'admin') throw fail('Username must start with a letter and contain 3–30 letters, numbers, dots, underscores or hyphens. The name admin is reserved.');
  return name;
}

export function defaultUsername(firstName, lastName) {
  const slug = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const first = slug(firstName).slice(0, 14) || 'member';
  const last = slug(lastName).slice(0, 15) || 'scout';
  const base = `${first}-${last}`;
  return (/^[a-z]/.test(base) ? base : `m-${base}`).slice(0, 30).replace(/-$/, '');
}

export function availableUsername(base, taken) {
  let candidate = base;
  let suffix = 1;
  while (taken.has(candidate)) {
    const ending = `-${++suffix}`;
    candidate = base.slice(0, 30 - ending.length) + ending;
  }
  taken.add(candidate);
  return candidate;
}

export async function resolveUsername(client, value, firstName, lastName, memberId = null) {
  const explicit = username(value);
  const base = defaultUsername(firstName, lastName);
  if (explicit && explicit !== base) return explicit;
  await client.query('SELECT pg_advisory_xact_lock(31002)');
  const taken = (await client.query('SELECT username FROM members WHERE username LIKE $1 AND ($2::uuid IS NULL OR id <> $2)', [`${base.slice(0, 20)}%`, memberId])).rows;
  return availableUsername(base, new Set(taken.map(row => row.username)));
}

export function cardId(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 60 || /[\u0000-\u001f\u007f]/.test(value)) throw fail('Card ID must contain 1–60 characters without control characters.');
  return value.trim();
}
