CREATE TABLE owner (
 id uuid PRIMARY KEY, singleton smallint NOT NULL DEFAULT 1 UNIQUE CHECK (singleton=1),
 login_name text NOT NULL UNIQUE, password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE installation (singleton smallint PRIMARY KEY CHECK(singleton=1), completed_at timestamptz);
INSERT INTO installation(singleton) VALUES (1);
CREATE TABLE business_settings (
 singleton smallint PRIMARY KEY DEFAULT 1 CHECK(singleton=1), owner_id uuid NOT NULL UNIQUE REFERENCES owner(id),
 name text NOT NULL, timezone text NOT NULL DEFAULT 'America/Edmonton', currency text NOT NULL DEFAULT 'CAD' CHECK(currency='CAD'),
 hourly_rate_minor bigint NOT NULL DEFAULT 0 CHECK(hourly_rate_minor>=0), rounding_minutes integer NOT NULL DEFAULT 15 CHECK(rounding_minutes IN (1,5,6,10,15,30,60)),
 invoice_prefix text NOT NULL DEFAULT 'INV-', tax_enabled boolean NOT NULL DEFAULT false,
 https_dismissed boolean NOT NULL DEFAULT false, vault_idle_minutes integer NOT NULL DEFAULT 5 CHECK(vault_idle_minutes BETWEEN 1 AND 60),
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE session (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owner(id), token_hash text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 revoked_at timestamptz
);
CREATE INDEX session_expiry ON session(expires_at);
CREATE TABLE auth_rate_limit (bucket text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL);
CREATE TABLE general_audit (id uuid PRIMARY KEY, type text NOT NULL, outcome text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
