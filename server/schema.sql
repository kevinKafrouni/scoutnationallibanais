CREATE SEQUENCE IF NOT EXISTS scout_id_seq START 31001;
CREATE SEQUENCE IF NOT EXISTS card_serial_seq START 1 MAXVALUE 9999 NO CYCLE;
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY,
  scout_id text UNIQUE NOT NULL DEFAULT lpad(nextval('scout_id_seq')::text, 8, '0'),
  first_name text NOT NULL CHECK (length(first_name) BETWEEN 1 AND 60),
  last_name text NOT NULL CHECK (length(last_name) BETWEEN 1 AND 60),
  date_of_birth date NOT NULL,
  blood_type text NOT NULL CHECK (blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown')),
  password_hash text NOT NULL,
  photo_data_url text NOT NULL DEFAULT '',
  access_code text UNIQUE NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now()
);
-- Existing members have no recorded father name; preserve their records.
ALTER TABLE members ADD COLUMN IF NOT EXISTS father_name text
  CHECK (father_name IS NULL OR length(btrim(father_name)) BETWEEN 1 AND 60);

CREATE TABLE IF NOT EXISTS access_codes (
  code text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_by uuid UNIQUE REFERENCES members(id),
  used_at timestamptz,
  CHECK ((used_by IS NULL) = (used_at IS NULL))
);
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS region_code text CHECK (region_code IN ('00','01','02','03','04','05'));
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS group_code text CHECK (
  group_code ~ '^[0-9]{2,3}$' AND group_code::integer BETWEEN 0 AND 100
  AND group_code = lpad(group_code::integer::text, CASE WHEN group_code::integer < 20 THEN 2 ELSE 3 END, '0'));
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS role_code text CHECK (role_code IN ('1','2'));
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='access_codes'::regclass AND conname='access_code_numbering_complete') THEN
    ALTER TABLE access_codes ADD CONSTRAINT access_code_numbering_complete CHECK (
      (region_code IS NULL AND group_code IS NULL AND role_code IS NULL)
      OR (region_code IS NOT NULL AND group_code IS NOT NULL AND role_code IS NOT NULL));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS card_id_counters (
  prefix text PRIMARY KEY CHECK (prefix ~ '^[0-9]{5,6}$'),
  last_serial integer NOT NULL DEFAULT 0 CHECK (last_serial BETWEEN 0 AND 9999)
);
ALTER TABLE members ADD COLUMN IF NOT EXISTS username text
  CHECK (username IS NULL OR (username ~ '^[a-z][a-z0-9._-]{2,29}$' AND username <> 'admin'));
CREATE UNIQUE INDEX IF NOT EXISTS members_username_unique ON members(username);
ALTER TABLE members ALTER COLUMN access_code DROP NOT NULL;
ALTER TABLE members ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='card_id') THEN
    ALTER TABLE members ADD COLUMN card_id text CHECK (length(btrim(card_id)) BETWEEN 1 AND 60);
    UPDATE members SET card_id=scout_id;
    ALTER TABLE members ADD CONSTRAINT members_card_id_key UNIQUE (card_id) DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
ALTER TABLE members ADD COLUMN IF NOT EXISTS region_code text CHECK (region_code IN ('00','01','02','03','04','05'));
ALTER TABLE members ADD COLUMN IF NOT EXISTS group_code text CHECK (
  group_code ~ '^[0-9]{2,3}$' AND group_code::integer BETWEEN 0 AND 100
  AND group_code = lpad(group_code::integer::text, CASE WHEN group_code::integer < 20 THEN 2 ELSE 3 END, '0'));
ALTER TABLE members ADD COLUMN IF NOT EXISTS role_code text CHECK (role_code IN ('1','2'));
ALTER TABLE members ADD COLUMN IF NOT EXISTS card_serial text CHECK (card_serial ~ '^[0-9]{4}$' AND card_serial <> '0000');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='members'::regclass AND conname='members_card_scheme_consistent') THEN
    ALTER TABLE members ADD CONSTRAINT members_card_scheme_consistent CHECK (
      (region_code IS NULL AND group_code IS NULL AND role_code IS NULL AND card_serial IS NULL)
      OR (region_code IS NOT NULL AND group_code IS NOT NULL AND role_code IS NOT NULL AND card_serial IS NOT NULL
        AND card_id = region_code || group_code || role_code || card_serial));
  END IF;
END $$;
CREATE OR REPLACE FUNCTION fill_member_card_id() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.card_id := COALESCE(NEW.card_id, NEW.scout_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS member_card_id_default ON members;
CREATE TRIGGER member_card_id_default BEFORE INSERT ON members FOR EACH ROW EXECUTE FUNCTION fill_member_card_id();
-- Stable UUIDs identify records while administrators change the visible Scout ID.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'members'::regclass
    AND conname = 'members_scout_id_key' AND NOT condeferrable) THEN
    ALTER TABLE members DROP CONSTRAINT members_scout_id_key;
    ALTER TABLE members ADD CONSTRAINT members_scout_id_key UNIQUE (scout_id) DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
-- Skip IDs reserved by imports instead of letting the next signup collide.
CREATE OR REPLACE FUNCTION next_scout_id() RETURNS text
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE candidate bigint; formatted text;
BEGIN
  PERFORM pg_advisory_xact_lock(31002);
  LOOP
    candidate := nextval('scout_id_seq');
    IF candidate > 99999999 THEN RAISE EXCEPTION 'Scout ID range exhausted'; END IF;
    formatted := lpad(candidate::text, 8, '0');
    IF NOT EXISTS (SELECT 1 FROM members WHERE scout_id = formatted OR card_id = formatted) THEN RETURN formatted; END IF;
  END LOOP;
END $$;
ALTER TABLE members ALTER COLUMN scout_id SET DEFAULT next_scout_id();
CREATE TABLE IF NOT EXISTS admin_account (
  id integer PRIMARY KEY CHECK (id = 1),
  password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('admin','member')),
  member_id uuid REFERENCES members(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  CHECK ((role = 'member' AND member_id IS NOT NULL) OR (role = 'admin' AND member_id IS NULL))
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY,
  hits integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS member_import_batches (
  id uuid PRIMARY KEY,
  added integer NOT NULL,
  updated integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- This app accesses PostgreSQL through its server, not through Supabase's Data API.
-- Table owners (the migration/server account) retain access; API users have none.
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_id_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON members, access_codes, admin_account, sessions, rate_limits, member_import_batches, card_id_counters FROM PUBLIC;
REVOKE ALL ON SEQUENCE scout_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE card_serial_seq FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE members, access_codes, admin_account, sessions, rate_limits, member_import_batches, card_id_counters FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE scout_id_seq FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE card_serial_seq FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
