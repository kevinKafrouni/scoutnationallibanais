import { cardId } from './member-identifiers.js';
import { formatCardParts } from '../card-numbering-config.js';

const fail = message => Object.assign(new Error(message), { status: 400 });
const pick = (value, fallback) => value === undefined || value === null || value === '' ? fallback : value;

export function cardPlan(body = {}, current = null) {
  const mode = body.cardIdMode || (['regionCode', 'groupCode', 'roleCode', 'cardSerial'].some(key => body[key] !== undefined && body[key] !== null && body[key] !== '') ? 'structured' : body.cardId || current?.cardId ? 'manual' : 'structured');
  if (!['manual', 'structured'].includes(mode)) throw fail('Choose automatic numbering or a manual Card ID.');
  if (mode === 'manual') {
    const value = cardId(pick(body.cardId, current?.cardId));
    if (!value) throw fail('Enter a manual Card ID, or choose automatic numbering.');
    return { cardIdMode: mode, cardId: value, regionCode: null, groupCode: null, roleCode: null, cardSerial: null };
  }
  function code(value, fallback, label, allowed) {
    const raw = String(value ?? fallback).trim();
    if (!/^\d+$/.test(raw) || !allowed(Number(raw))) throw fail(`Choose a valid ${label}.`);
    return Number(raw);
  }
  const region = code(pick(body.regionCode, current?.regionCode), '00', 'region (00–05)', value => value <= 5);
  const group = code(pick(body.groupCode, current?.groupCode), '00', 'group (00–100)', value => value <= 100);
  const role = code(pick(body.roleCode, current?.roleCode), '2', 'role (1 or 2)', value => value === 1 || value === 2);
  const serialValue = pick(body.cardSerial, current?.cardSerial);
  const serial = serialValue !== undefined && serialValue !== null ? code(serialValue, null, 'serial (0001–9999)', value => value >= 1 && value <= 9999) : null;
  const plan = { cardIdMode: mode, regionCode: String(region).padStart(2, '0'), groupCode: String(group).padStart(group < 20 ? 2 : 3, '0'), roleCode: String(role), cardSerial: serial === null ? null : String(serial).padStart(4, '0') };
  return { ...plan, cardId: plan.cardSerial ? formatCardParts(plan) : null };
}

export async function advanceCardSerial(client) {
  await client.query(`SELECT setval('card_serial_seq', GREATEST(last_value,
    (SELECT COALESCE(max(card_serial::integer),1) FROM members)),true) FROM card_serial_seq`);
}

export async function resolveCard(client, body = {}, current = null) {
  await client.query('SELECT pg_advisory_xact_lock(31002)');
  let plan = cardPlan(body, current);
  if (plan.cardIdMode === 'manual') return plan;
  if (!plan.cardSerial) {
    while (true) {
      const state = (await client.query('SELECT last_value,is_called FROM card_serial_seq')).rows[0];
      if (state.is_called && Number(state.last_value) >= 9999) throw fail('All four-digit serial numbers have been allocated.');
      const serial = Number((await client.query("SELECT nextval('card_serial_seq') AS serial")).rows[0].serial);
      if (serial > 9999) throw fail('All four-digit serial numbers have been allocated.');
      plan = cardPlan({ ...plan, cardSerial: String(serial) });
      const used = await client.query('SELECT id FROM members WHERE card_serial=$1 OR card_id=$2', [plan.cardSerial, plan.cardId]);
      if (!used.rows.length) break;
    }
  }
  return plan;
}

export async function resolveCodeCard(client, code, memberId = null) {
  await client.query('SELECT pg_advisory_xact_lock(31002)');
  const plan = cardPlan({ cardIdMode: 'structured', regionCode: code.region_code, groupCode: code.group_code, roleCode: code.role_code });
  const prefix = `${plan.regionCode}${plan.groupCode}${plan.roleCode}`;
  // Include existing manual IDs matching the format; exclude the pending member's placeholder.
  const existing = (await client.query(`SELECT COALESCE(max(right(card_id,4)::integer),0) AS maximum
    FROM members WHERE card_id ~ $1 AND ($2::uuid IS NULL OR id <> $2)`, [`^${prefix}[0-9]{4}$`, memberId])).rows[0];
  await client.query('INSERT INTO card_id_counters (prefix) VALUES ($1) ON CONFLICT DO NOTHING', [prefix]);
  const result = await client.query(`UPDATE card_id_counters SET last_serial=GREATEST(last_serial,$2)+1
    WHERE prefix=$1 AND GREATEST(last_serial,$2)<9999 RETURNING last_serial`, [prefix, Number(existing.maximum)]);
  if (!result.rows.length) throw fail('All four-digit serial numbers for this region, group and role have been allocated.');
  return cardPlan({ ...plan, cardSerial: String(result.rows[0].last_serial) });
}
