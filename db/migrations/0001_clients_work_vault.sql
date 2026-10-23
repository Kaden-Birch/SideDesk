CREATE TABLE client (
 id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160), type text NOT NULL CHECK(type IN ('person','business')),
 email text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', billing_address text NOT NULL DEFAULT '',
 hourly_rate_minor bigint CHECK(hourly_rate_minor>=0), archived_at timestamptz,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE client_contact (
 id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES client(id), name text NOT NULL, email text NOT NULL DEFAULT '',
 phone text NOT NULL DEFAULT '', role text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE activity (
 id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES client(id), title text NOT NULL, billable boolean NOT NULL DEFAULT true,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','cancelled')), notes text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,client_id)
);
CREATE TABLE note (
 id uuid PRIMARY KEY, client_id uuid REFERENCES client(id), activity_id uuid REFERENCES activity(id), body text NOT NULL CHECK(length(body)<=20000),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(num_nonnulls(client_id,activity_id)=1)
);
CREATE TABLE timer (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owner(id), activity_id uuid NOT NULL REFERENCES activity(id),
 state text NOT NULL CHECK(state IN ('running','paused','stopped')), segment_started_at timestamptz,
 accumulated_seconds integer NOT NULL DEFAULT 0 CHECK(accumulated_seconds>=0),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 rate_minor bigint NOT NULL CHECK(rate_minor>=0), rounding_minutes integer NOT NULL, billable boolean NOT NULL,
 CHECK((state='running')=(segment_started_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_timer ON timer(owner_id) WHERE state IN ('running','paused');
CREATE TABLE timer_segment (
 id uuid PRIMARY KEY, timer_id uuid NOT NULL REFERENCES timer(id), started_at timestamptz NOT NULL, ended_at timestamptz NOT NULL,
 CHECK(ended_at>=started_at)
);
CREATE TABLE time_entry (
 id uuid PRIMARY KEY, activity_id uuid NOT NULL REFERENCES activity(id), timer_id uuid UNIQUE REFERENCES timer(id),
 duration_seconds integer NOT NULL CHECK(duration_seconds BETWEEN 1 AND 31536000), billable boolean NOT NULL,
 source text NOT NULL CHECK(source IN ('manual','timer')), rate_minor bigint NOT NULL CHECK(rate_minor>=0),
 rounding_minutes integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE idempotency (
 key uuid PRIMARY KEY, operation text NOT NULL, request_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vault (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL UNIQUE REFERENCES owner(id), format integer NOT NULL CHECK(format=1),
 hkdf_salt text NOT NULL, password_envelope jsonb NOT NULL, recovery_envelope jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE credential (
 id uuid PRIMARY KEY, vault_id uuid NOT NULL REFERENCES vault(id), client_id uuid NOT NULL REFERENCES client(id),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160), payload jsonb NOT NULL, version integer NOT NULL DEFAULT 1,
 archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vault_nonce (
 vault_id uuid NOT NULL REFERENCES vault(id), key_scope text NOT NULL, nonce text NOT NULL,
 PRIMARY KEY(vault_id,key_scope,nonce)
);
CREATE TABLE credential_audit_event (
 id uuid PRIMARY KEY, credential_id uuid REFERENCES credential(id), type text NOT NULL CHECK(type IN ('create','edit','delete','unlock','unlock_failed','lock','reveal','copy','totp_copy','recovery','password_change')),
 provenance text NOT NULL CHECK(provenance IN ('server','browser')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_lookup ON client(name);
CREATE INDEX activity_client ON activity(client_id,created_at DESC);
CREATE INDEX credential_client ON credential(client_id) WHERE archived_at IS NULL;
CREATE INDEX note_client ON note(client_id,created_at DESC);
