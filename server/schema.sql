CREATE SEQUENCE IF NOT EXISTS scout_id_seq START 31001;
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
CREATE TABLE IF NOT EXISTS access_codes (
  code text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_by uuid UNIQUE REFERENCES members(id),
  used_at timestamptz,
  CHECK ((used_by IS NULL) = (used_at IS NULL))
);
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

-- This app accesses PostgreSQL through its server, not through Supabase's Data API.
-- Table owners (the migration/server account) retain access; API users have none.
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON members, access_codes, admin_account, sessions, rate_limits FROM PUBLIC;
REVOKE ALL ON SEQUENCE scout_id_seq FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE members, access_codes, admin_account, sessions, rate_limits FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE scout_id_seq FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
