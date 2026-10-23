ALTER TABLE business_settings ADD COLUMN legal_name text NOT NULL DEFAULT '', ADD COLUMN address text NOT NULL DEFAULT '', ADD COLUMN email text NOT NULL DEFAULT '', ADD COLUMN phone text NOT NULL DEFAULT '', ADD COLUMN registration_number text NOT NULL DEFAULT '', ADD COLUMN payment_instructions text NOT NULL DEFAULT '', ADD COLUMN invoice_terms text NOT NULL DEFAULT '', ADD COLUMN rounding_scope text NOT NULL DEFAULT 'entry' CHECK(rounding_scope IN ('entry','group')), ADD COLUMN accent_color text NOT NULL DEFAULT '#365f9b' CHECK(accent_color ~ '^#[0-9a-fA-F]{6}$');
CREATE TABLE job (
 id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES client(id), title text NOT NULL, description text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('draft','open','in_progress','waiting','completed','cancelled')),
 priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')), due_date date,
 hourly_rate_minor bigint CHECK(hourly_rate_minor BETWEEN 0 AND 100000000),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,client_id)
);
ALTER TABLE activity ADD COLUMN job_id uuid, ADD CONSTRAINT activity_job_client_fk FOREIGN KEY(job_id,client_id) REFERENCES job(id,client_id);
ALTER TABLE timer ADD COLUMN job_id uuid REFERENCES job(id), ADD COLUMN rounding_scope text NOT NULL DEFAULT 'entry' CHECK(rounding_scope IN ('entry','group')), ADD COLUMN rate_source text NOT NULL DEFAULT 'legacy';
ALTER TABLE time_entry ADD COLUMN job_id uuid REFERENCES job(id), ADD COLUMN rounding_scope text NOT NULL DEFAULT 'entry' CHECK(rounding_scope IN ('entry','group')), ADD COLUMN rate_source text NOT NULL DEFAULT 'legacy', ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE note ADD COLUMN job_id uuid REFERENCES job(id);
ALTER TABLE note DROP CONSTRAINT note_check;
ALTER TABLE note ADD CONSTRAINT note_one_context CHECK(num_nonnulls(client_id,activity_id,job_id)=1);
CREATE TABLE invoice (
 id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES client(id), state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','issued','void')),
 number text UNIQUE, sequence_number bigint UNIQUE, issue_date date NOT NULL, due_date date NOT NULL CHECK(due_date>=issue_date),
 paper text NOT NULL DEFAULT 'Letter' CHECK(paper IN ('A4','Letter')), currency text NOT NULL DEFAULT 'CAD' CHECK(currency='CAD'),
 issuer_snapshot jsonb NOT NULL, client_snapshot jsonb NOT NULL, notes text NOT NULL DEFAULT '', terms text NOT NULL DEFAULT '',
 subtotal_minor bigint NOT NULL DEFAULT 0 CHECK(subtotal_minor>=0), discount_minor bigint NOT NULL DEFAULT 0 CHECK(discount_minor>=0),
 tax_minor bigint NOT NULL DEFAULT 0 CHECK(tax_minor>=0), total_minor bigint NOT NULL DEFAULT 0 CHECK(total_minor BETWEEN 0 AND 100000000000000),
 snapshot jsonb, pdf_bytes bytea, pdf_sha256 text, issued_at timestamptz, voided_at timestamptz, void_reason text,
 version integer NOT NULL DEFAULT 1, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(total_minor=subtotal_minor-discount_minor+tax_minor),
 CHECK((state='draft' AND number IS NULL AND sequence_number IS NULL AND issued_at IS NULL AND pdf_bytes IS NULL AND snapshot IS NULL) OR (state IN ('issued','void') AND number IS NOT NULL AND sequence_number>0 AND issued_at IS NOT NULL AND snapshot IS NOT NULL AND pdf_bytes IS NOT NULL AND octet_length(pdf_bytes) BETWEEN 5 AND 10000000 AND pdf_sha256 IS NOT NULL))
);
CREATE TABLE invoice_line (
 id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoice(id), position integer NOT NULL CHECK(position>=0),
 kind text NOT NULL CHECK(kind IN ('manual','time')), description text NOT NULL CHECK(length(description) BETWEEN 1 AND 500),
 quantity numeric(12,6) NOT NULL CHECK(quantity>0), unit_minor bigint NOT NULL CHECK(unit_minor BETWEEN 0 AND 1000000000),
 discount_bps integer NOT NULL CHECK(discount_bps BETWEEN 0 AND 10000), tax_bps integer NOT NULL CHECK(tax_bps BETWEEN 0 AND 10000), tax_label text NOT NULL,
 subtotal_minor bigint NOT NULL CHECK(subtotal_minor>=0), discount_minor bigint NOT NULL CHECK(discount_minor>=0), tax_minor bigint NOT NULL CHECK(tax_minor>=0), total_minor bigint NOT NULL CHECK(total_minor>=0),
 original_seconds integer, billable_seconds integer, source_snapshot jsonb NOT NULL DEFAULT '[]', UNIQUE(invoice_id,position)
);
CREATE TABLE invoice_allocation (
 id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoice(id), line_id uuid NOT NULL REFERENCES invoice_line(id), time_entry_id uuid NOT NULL REFERENCES time_entry(id),
 allocated_seconds integer NOT NULL CHECK(allocated_seconds>0), released_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_time_allocation ON invoice_allocation(time_entry_id) WHERE released_at IS NULL;
CREATE TABLE invoice_counter (singleton smallint PRIMARY KEY CHECK(singleton=1), next_number bigint NOT NULL CHECK(next_number>0));
INSERT INTO invoice_counter VALUES(1,1);
CREATE TABLE payment (
 id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoice(id), kind text NOT NULL CHECK(kind IN ('receipt','reversal')),
 amount_minor bigint NOT NULL CHECK(amount_minor>0), method text NOT NULL CHECK(method IN ('e_transfer','cash','cheque','other')),
 received_on date NOT NULL, reference text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '', reverses_id uuid UNIQUE REFERENCES payment(id),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK((kind='reversal')=(reverses_id IS NOT NULL))
);
CREATE TABLE invoice_event (id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoice(id), type text NOT NULL, summary text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE time_entry_revision (id uuid PRIMARY KEY, time_entry_id uuid NOT NULL REFERENCES time_entry(id), previous_value jsonb NOT NULL, new_value jsonb NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX invoice_client ON invoice(client_id,created_at DESC);
CREATE INDEX invoice_events ON invoice_event(invoice_id,created_at);
CREATE INDEX job_client ON job(client_id,created_at DESC);
CREATE INDEX payment_invoice ON payment(invoice_id);

CREATE FUNCTION append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Append-only history cannot be changed' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER payment_append_only BEFORE UPDATE OR DELETE ON payment FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER invoice_event_append_only BEFORE UPDATE OR DELETE ON invoice_event FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER time_revision_append_only BEFORE UPDATE OR DELETE ON time_entry_revision FOR EACH ROW EXECUTE FUNCTION append_only();

CREATE FUNCTION guard_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE net_paid bigint;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.state<>'draft' THEN RAISE EXCEPTION 'Issued invoice cannot be deleted' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.state<>'draft' THEN
  IF OLD.state<>'issued' OR NEW.state<>'void' OR length(trim(COALESCE(NEW.void_reason,'')))=0 OR NEW.voided_at IS NULL
   OR (to_jsonb(NEW)-ARRAY['state','void_reason','voided_at','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','void_reason','voided_at','version','updated_at'])
  THEN RAISE EXCEPTION 'Issued invoice is immutable' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(CASE WHEN kind='receipt' THEN amount_minor ELSE -amount_minor END),0) INTO net_paid FROM payment WHERE invoice_id=OLD.id;
  IF net_paid<>0 THEN RAISE EXCEPTION 'Reverse receipts before voiding' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER invoice_immutable BEFORE UPDATE OR DELETE ON invoice FOR EACH ROW EXECUTE FUNCTION guard_invoice();
CREATE FUNCTION guard_invoice_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_state text; parent_id uuid;
BEGIN
 IF TG_OP='UPDATE' AND OLD.invoice_id<>NEW.invoice_id THEN RAISE EXCEPTION 'Cannot move invoice line' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN parent_id=OLD.invoice_id; ELSE parent_id=NEW.invoice_id; END IF;
 SELECT state INTO parent_state FROM invoice WHERE id=parent_id FOR UPDATE;
 IF parent_state<>'draft' THEN RAISE EXCEPTION 'Issued invoice lines are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER invoice_line_immutable BEFORE INSERT OR UPDATE OR DELETE ON invoice_line FOR EACH ROW EXECUTE FUNCTION guard_invoice_line();
CREATE FUNCTION guard_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent invoice%ROWTYPE; source time_entry%ROWTYPE; source_client uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
  SELECT * INTO parent FROM invoice WHERE id=OLD.invoice_id FOR UPDATE;
  IF parent.state<>'void' OR OLD.released_at IS NOT NULL OR NEW.released_at IS NULL OR (to_jsonb(NEW)-'released_at') IS DISTINCT FROM (to_jsonb(OLD)-'released_at')
   THEN RAISE EXCEPTION 'Invalid allocation release' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
  SELECT * INTO parent FROM invoice WHERE id=OLD.invoice_id FOR UPDATE;
  IF parent.state<>'draft' THEN RAISE EXCEPTION 'Historical allocation cannot be deleted' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 SELECT * INTO parent FROM invoice WHERE id=NEW.invoice_id FOR UPDATE;
 SELECT * INTO source FROM time_entry WHERE id=NEW.time_entry_id FOR UPDATE;
 SELECT client_id INTO source_client FROM activity WHERE id=source.activity_id;
 IF parent.state<>'draft' OR NOT source.billable OR source_client<>parent.client_id OR source.duration_seconds<>NEW.allocated_seconds OR NEW.released_at IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM invoice_line WHERE id=NEW.line_id AND invoice_id=parent.id AND kind='time')
 THEN RAISE EXCEPTION 'Invalid or partial time allocation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_allocation FOR EACH ROW EXECUTE FUNCTION guard_allocation();
CREATE FUNCTION release_void_sources() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.state='void' AND OLD.state='issued' THEN UPDATE invoice_allocation SET released_at=now() WHERE invoice_id=NEW.id AND released_at IS NULL; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER release_void_sources AFTER UPDATE ON invoice FOR EACH ROW EXECUTE FUNCTION release_void_sources();
CREATE FUNCTION guard_time_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry_client uuid;
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') AND EXISTS(SELECT 1 FROM invoice_allocation WHERE time_entry_id=OLD.id AND released_at IS NULL)
 THEN RAISE EXCEPTION 'Allocated time cannot be changed' USING ERRCODE='23514'; END IF;
 IF TG_OP<>'DELETE' AND NEW.job_id IS NOT NULL THEN
  SELECT client_id INTO entry_client FROM activity WHERE id=NEW.activity_id;
  IF NOT EXISTS(SELECT 1 FROM job WHERE id=NEW.job_id AND client_id=entry_client) THEN RAISE EXCEPTION 'Job client mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER time_billing_guard BEFORE INSERT OR UPDATE OR DELETE ON time_entry FOR EACH ROW EXECUTE FUNCTION guard_time_entry();
CREATE FUNCTION guard_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent invoice%ROWTYPE; original payment%ROWTYPE; net_paid bigint;
BEGIN
 SELECT * INTO parent FROM invoice WHERE id=NEW.invoice_id FOR UPDATE;
 IF parent.state<>'issued' THEN RAISE EXCEPTION 'Only issued invoices accept payments' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(CASE WHEN kind='receipt' THEN amount_minor ELSE -amount_minor END),0) INTO net_paid FROM payment WHERE invoice_id=parent.id;
 IF NEW.kind='receipt' AND NEW.amount_minor>parent.total_minor-net_paid THEN RAISE EXCEPTION 'Payment exceeds balance' USING ERRCODE='23514'; END IF;
 IF NEW.kind='reversal' THEN
  SELECT * INTO original FROM payment WHERE id=NEW.reverses_id;
  IF original.id IS NULL OR original.kind<>'receipt' OR original.invoice_id<>parent.id OR original.amount_minor<>NEW.amount_minor
   THEN RAISE EXCEPTION 'Invalid receipt reversal' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payment_guard BEFORE INSERT ON payment FOR EACH ROW EXECUTE FUNCTION guard_payment();
CREATE TABLE job_attachment (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES job(id), storage_key uuid NOT NULL UNIQUE,
 original_name text NOT NULL CHECK(length(original_name) BETWEEN 1 AND 200), byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760), sha256 text NOT NULL,
 archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_attachments ON job_attachment(job_id) WHERE archived_at IS NULL;
