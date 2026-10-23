CREATE TABLE tax_profile (
 id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 components jsonb NOT NULL CHECK(jsonb_typeof(components)='array' AND jsonb_array_length(components) BETWEEN 1 AND 4),
 version integer NOT NULL DEFAULT 1, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE invoice_line ADD COLUMN tax_snapshot jsonb NOT NULL DEFAULT '[]', ADD COLUMN tax_treatment text NOT NULL DEFAULT 'taxable' CHECK(tax_treatment IN ('taxable','zero','exempt'));
ALTER TABLE invoice_line DROP CONSTRAINT invoice_line_kind_check;
ALTER TABLE invoice_line ADD CONSTRAINT invoice_line_kind_check CHECK(kind IN ('manual','time','charge'));
CREATE TABLE quote (
 id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES client(id), number text UNIQUE,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','sent','accepted','declined','void')),
 issue_date date NOT NULL, expiry_date date NOT NULL CHECK(expiry_date>=issue_date),
 document jsonb NOT NULL, total_minor bigint NOT NULL CHECK(total_minor BETWEEN 0 AND 100000000000000),
 pdf_bytes bytea, pdf_sha256 text, published_at timestamptz, decision_note text NOT NULL DEFAULT '',
 predecessor_id uuid REFERENCES quote(id), version integer NOT NULL DEFAULT 1, archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((state='draft' AND number IS NULL AND pdf_bytes IS NULL AND published_at IS NULL) OR (state<>'draft' AND number IS NOT NULL AND pdf_bytes IS NOT NULL AND pdf_sha256 IS NOT NULL AND published_at IS NOT NULL))
);
CREATE TABLE quote_counter (singleton smallint PRIMARY KEY CHECK(singleton=1), next_number bigint NOT NULL CHECK(next_number>0));
INSERT INTO quote_counter VALUES(1,1);
ALTER TABLE invoice ADD COLUMN source_quote_id uuid REFERENCES quote(id);
CREATE UNIQUE INDEX one_active_quote_invoice ON invoice(source_quote_id) WHERE archived_at IS NULL AND state<>'void';
ALTER TABLE job ADD COLUMN source_quote_id uuid UNIQUE REFERENCES quote(id);
CREATE TABLE quote_event(id uuid PRIMARY KEY,quote_id uuid NOT NULL REFERENCES quote(id),type text NOT NULL,summary text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER quote_event_append_only BEFORE UPDATE OR DELETE ON quote_event FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE FUNCTION guard_quote() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Archive drafts; preserve quote history' USING ERRCODE='23514'; END IF;
 IF OLD.state<>'draft' THEN
  IF (to_jsonb(NEW)-ARRAY['state','decision_note','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','decision_note','version','updated_at'])
   OR NOT ((OLD.state IN ('published','sent') AND NEW.state IN ('sent','accepted','declined','void')) OR (OLD.state='accepted' AND NEW.state='void'))
   OR (NEW.state IN ('accepted','declined','void') AND length(trim(NEW.decision_note))=0)
  THEN RAISE EXCEPTION 'Published quote is immutable; use explicit state transition' USING ERRCODE='23514'; END IF;
  IF NEW.state='void' AND (EXISTS(SELECT 1 FROM invoice WHERE source_quote_id=OLD.id AND archived_at IS NULL AND state<>'void') OR EXISTS(SELECT 1 FROM job WHERE source_quote_id=OLD.id)) THEN RAISE EXCEPTION 'Converted quote cannot be voided' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER quote_guard BEFORE UPDATE OR DELETE ON quote FOR EACH ROW EXECUTE FUNCTION guard_quote();
CREATE TABLE expense (
 id uuid PRIMARY KEY, vendor text NOT NULL CHECK(length(vendor) BETWEEN 1 AND 160), spent_on date NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 0 AND 100000000000000), tax_minor bigint NOT NULL CHECK(tax_minor BETWEEN 0 AND amount_minor),
 currency text NOT NULL DEFAULT 'CAD' CHECK(currency='CAD'),category text NOT NULL,description text NOT NULL DEFAULT '',payment_method text NOT NULL,
 client_id uuid REFERENCES client(id),job_id uuid, billable boolean NOT NULL DEFAULT false, recovery_minor bigint NOT NULL DEFAULT 0 CHECK(recovery_minor BETWEEN 0 AND 1000000000),
 version integer NOT NULL DEFAULT 1,archived_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(job_id,client_id) REFERENCES job(id,client_id),CHECK(job_id IS NULL OR client_id IS NOT NULL),CHECK(NOT billable OR client_id IS NOT NULL),CHECK(billable OR recovery_minor=0)
);
ALTER TABLE note ADD COLUMN expense_id uuid REFERENCES expense(id);
ALTER TABLE note DROP CONSTRAINT note_one_context;
ALTER TABLE note ADD CONSTRAINT note_one_context CHECK(num_nonnulls(client_id,activity_id,job_id,expense_id)=1);
CREATE TABLE expense_attachment (
 id uuid PRIMARY KEY,expense_id uuid NOT NULL REFERENCES expense(id),storage_key uuid UNIQUE NOT NULL,original_name text NOT NULL CHECK(length(original_name) BETWEEN 1 AND 200),
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760),sha256 text NOT NULL,archived_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE trip (
 id uuid PRIMARY KEY,travelled_on date NOT NULL,purpose text NOT NULL,origin text NOT NULL DEFAULT '',destination text NOT NULL DEFAULT '',
 distance_milli_km integer NOT NULL CHECK(distance_milli_km BETWEEN 0 AND 100000000),duration_seconds integer NOT NULL CHECK(duration_seconds BETWEEN 0 AND 31536000),
 mileage_rate_minor integer NOT NULL CHECK(mileage_rate_minor BETWEEN 0 AND 100000),time_rate_minor bigint NOT NULL CHECK(time_rate_minor BETWEEN 0 AND 100000000),
 rounding_minutes integer NOT NULL CHECK(rounding_minutes IN (1,5,6,10,15,30,60)),
 client_id uuid REFERENCES client(id),job_id uuid,billable_mileage boolean NOT NULL DEFAULT false,billable_time boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1,archived_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(job_id,client_id) REFERENCES job(id,client_id),CHECK(job_id IS NULL OR client_id IS NOT NULL),CHECK(NOT (billable_mileage OR billable_time) OR client_id IS NOT NULL)
);
CREATE TABLE client_charge (
 id uuid PRIMARY KEY,client_id uuid NOT NULL REFERENCES client(id),job_id uuid,expense_id uuid REFERENCES expense(id),trip_id uuid REFERENCES trip(id),
 kind text NOT NULL CHECK(kind IN ('expense','mileage','travel_time')),description text NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 0 AND 1000000000),
 snapshot jsonb NOT NULL,archived_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(job_id,client_id) REFERENCES job(id,client_id),CHECK(num_nonnulls(expense_id,trip_id)=1),CHECK((kind='expense')=(expense_id IS NOT NULL)),UNIQUE(expense_id),UNIQUE(trip_id,kind)
);
CREATE TABLE charge_allocation (
 id uuid PRIMARY KEY,invoice_id uuid NOT NULL REFERENCES invoice(id),line_id uuid NOT NULL REFERENCES invoice_line(id),charge_id uuid NOT NULL REFERENCES client_charge(id),
 allocated_minor bigint NOT NULL CHECK(allocated_minor>=0),released_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_charge_allocation ON charge_allocation(charge_id) WHERE released_at IS NULL;
CREATE FUNCTION guard_charge_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent invoice%ROWTYPE; source client_charge%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO parent FROM invoice WHERE id=NEW.invoice_id FOR UPDATE;
  SELECT * INTO source FROM client_charge WHERE id=NEW.charge_id FOR UPDATE;
  IF parent.state<>'draft' OR parent.archived_at IS NOT NULL OR source.archived_at IS NOT NULL OR source.client_id<>parent.client_id OR source.amount_minor<>NEW.allocated_minor OR NEW.released_at IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM invoice_line WHERE id=NEW.line_id AND invoice_id=parent.id AND kind='charge') THEN RAISE EXCEPTION 'Invalid or partial charge allocation' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO parent FROM invoice WHERE id=OLD.invoice_id FOR UPDATE;
 IF TG_OP='DELETE' THEN
  IF parent.state<>'draft' THEN RAISE EXCEPTION 'Historical charge allocation cannot be deleted' USING ERRCODE='23514'; END IF; RETURN OLD;
 END IF;
 IF parent.state<>'void' OR OLD.released_at IS NOT NULL OR NEW.released_at IS NULL OR (to_jsonb(NEW)-'released_at') IS DISTINCT FROM (to_jsonb(OLD)-'released_at') THEN RAISE EXCEPTION 'Invalid charge release' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER charge_allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON charge_allocation FOR EACH ROW EXECUTE FUNCTION guard_charge_allocation();
CREATE FUNCTION guard_charge_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM charge_allocation WHERE charge_id=OLD.id AND released_at IS NULL) THEN RAISE EXCEPTION 'Allocated charge cannot be changed' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER charge_source_guard BEFORE UPDATE OR DELETE ON client_charge FOR EACH ROW EXECUTE FUNCTION guard_charge_source();
CREATE FUNCTION release_void_charges() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.state='void' AND OLD.state='issued' THEN UPDATE charge_allocation SET released_at=now() WHERE invoice_id=NEW.id AND released_at IS NULL; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER release_void_charges AFTER UPDATE ON invoice FOR EACH ROW EXECUTE FUNCTION release_void_charges();
CREATE TABLE invoice_adjustment (
 id uuid PRIMARY KEY,invoice_id uuid NOT NULL REFERENCES invoice(id),kind text NOT NULL CHECK(kind IN ('credit','credit_reversal','refund','refund_reversal')),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 100000000000000),occurred_on date NOT NULL,reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
 method text NOT NULL DEFAULT 'other' CHECK(method IN ('e_transfer','cash','cheque','other')),reference text NOT NULL DEFAULT '',reverses_id uuid UNIQUE REFERENCES invoice_adjustment(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind IN ('credit_reversal','refund_reversal'))=(reverses_id IS NOT NULL))
);
ALTER TABLE invoice_adjustment ADD COLUMN tax_minor bigint NOT NULL DEFAULT 0 CHECK(tax_minor BETWEEN 0 AND amount_minor);
CREATE TRIGGER adjustment_append_only BEFORE UPDATE OR DELETE ON invoice_adjustment FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TABLE smtp_settings (
 singleton smallint PRIMARY KEY CHECK(singleton=1),host text NOT NULL,port integer NOT NULL CHECK(port BETWEEN 1 AND 65535),
 security text NOT NULL CHECK(security IN ('tls','starttls','plain')),username text NOT NULL DEFAULT '',password_envelope jsonb,from_address text NOT NULL,from_name text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),CHECK(security<>'plain' OR (username='' AND password_envelope IS NULL))
);
CREATE TABLE email_attempt (
 id uuid PRIMARY KEY,request_key uuid UNIQUE NOT NULL,request_hash text NOT NULL,invoice_id uuid REFERENCES invoice(id),quote_id uuid REFERENCES quote(id),
 recipient text NOT NULL,subject text NOT NULL,body text NOT NULL,document_sha256 text NOT NULL,message_id text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(invoice_id,quote_id)=1)
);
CREATE TABLE email_result (
 id uuid PRIMARY KEY,attempt_id uuid UNIQUE NOT NULL REFERENCES email_attempt(id),outcome text NOT NULL CHECK(outcome IN ('accepted','failed','unknown')),
 summary text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER email_attempt_append_only BEFORE UPDATE OR DELETE ON email_attempt FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER email_result_append_only BEFORE UPDATE OR DELETE ON email_result FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE INDEX quote_client ON quote(client_id,created_at DESC);
CREATE INDEX expense_client ON expense(client_id,spent_on);
CREATE INDEX trip_client ON trip(client_id,travelled_on);
CREATE INDEX adjustment_invoice ON invoice_adjustment(invoice_id);
CREATE VIEW invoice_financials AS
SELECT i.id,i.total_minor,COALESCE(p.receipts,0)-COALESCE(a.refunds,0) AS net_cash_minor,COALESCE(a.credits,0) AS credit_minor,
 GREATEST(i.total_minor-COALESCE(a.credits,0)-COALESCE(p.receipts,0)+COALESCE(a.refunds,0),0) AS balance_minor,
 GREATEST(COALESCE(p.receipts,0)-COALESCE(a.refunds,0)-i.total_minor+COALESCE(a.credits,0),0) AS customer_credit_minor,COALESCE(a.credit_tax,0) AS credit_tax_minor
FROM invoice i
LEFT JOIN LATERAL(SELECT sum(CASE WHEN kind='receipt' THEN amount_minor ELSE -amount_minor END) AS receipts FROM payment WHERE invoice_id=i.id)p ON true
LEFT JOIN LATERAL(SELECT sum(CASE kind WHEN 'credit' THEN amount_minor WHEN 'credit_reversal' THEN -amount_minor ELSE 0 END) AS credits,sum(CASE kind WHEN 'refund' THEN amount_minor WHEN 'refund_reversal' THEN -amount_minor ELSE 0 END) AS refunds,sum(CASE kind WHEN 'credit' THEN tax_minor WHEN 'credit_reversal' THEN -tax_minor ELSE 0 END) AS credit_tax FROM invoice_adjustment WHERE invoice_id=i.id)a ON true;
CREATE FUNCTION guard_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent invoice%ROWTYPE; f invoice_financials%ROWTYPE; original invoice_adjustment%ROWTYPE;
BEGIN
 SELECT * INTO parent FROM invoice WHERE id=NEW.invoice_id FOR UPDATE;
 IF parent.state<>'issued' THEN RAISE EXCEPTION 'Only issued invoices accept adjustments' USING ERRCODE='23514'; END IF;
 SELECT * INTO f FROM invoice_financials WHERE id=parent.id;
 IF NEW.kind='credit' AND NEW.amount_minor>parent.total_minor-f.credit_minor THEN RAISE EXCEPTION 'Credit exceeds remaining invoice value' USING ERRCODE='23514'; END IF;
 IF NEW.kind='credit' AND (NEW.tax_minor>parent.tax_minor-f.credit_tax_minor OR NEW.amount_minor-NEW.tax_minor>parent.total_minor-parent.tax_minor-f.credit_minor+f.credit_tax_minor) THEN RAISE EXCEPTION 'Credit exceeds remaining tax or pretax invoice value' USING ERRCODE='23514'; END IF;
 IF NEW.kind IN ('refund','refund_reversal') AND NEW.tax_minor<>0 THEN RAISE EXCEPTION 'Refund cash must not duplicate a tax credit' USING ERRCODE='23514'; END IF;
 IF NEW.kind='refund' AND (NEW.amount_minor>f.customer_credit_minor OR NEW.amount_minor>f.net_cash_minor) THEN RAISE EXCEPTION 'Refund exceeds refundable customer credit' USING ERRCODE='23514'; END IF;
 IF NEW.reverses_id IS NOT NULL THEN
  SELECT * INTO original FROM invoice_adjustment WHERE id=NEW.reverses_id;
  IF original.id IS NULL OR original.invoice_id<>parent.id OR original.amount_minor<>NEW.amount_minor OR original.tax_minor<>NEW.tax_minor
   OR NOT ((NEW.kind='credit_reversal' AND original.kind='credit') OR (NEW.kind='refund_reversal' AND original.kind='refund')) THEN RAISE EXCEPTION 'Invalid adjustment reversal' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER adjustment_guard BEFORE INSERT ON invoice_adjustment FOR EACH ROW EXECUTE FUNCTION guard_adjustment();
CREATE OR REPLACE FUNCTION guard_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent invoice%ROWTYPE; original payment%ROWTYPE; f invoice_financials%ROWTYPE;
BEGIN
 SELECT * INTO parent FROM invoice WHERE id=NEW.invoice_id FOR UPDATE;
 IF parent.state<>'issued' THEN RAISE EXCEPTION 'Only issued invoices accept payments' USING ERRCODE='23514'; END IF;
 SELECT * INTO f FROM invoice_financials WHERE id=parent.id;
 IF NEW.kind='receipt' AND NEW.amount_minor>f.balance_minor THEN RAISE EXCEPTION 'Payment exceeds balance' USING ERRCODE='23514'; END IF;
 IF NEW.kind='reversal' THEN
  SELECT * INTO original FROM payment WHERE id=NEW.reverses_id;
  IF original.id IS NULL OR original.kind<>'receipt' OR original.invoice_id<>parent.id OR original.amount_minor<>NEW.amount_minor OR NEW.amount_minor>f.net_cash_minor
   THEN RAISE EXCEPTION 'Invalid receipt reversal; reverse refunds first if needed' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION guard_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f invoice_financials%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.state<>'draft' THEN RAISE EXCEPTION 'Issued invoice cannot be deleted' USING ERRCODE='23514'; END IF; RETURN OLD;
 END IF;
 IF OLD.state<>'draft' THEN
  IF OLD.state<>'issued' OR NEW.state<>'void' OR length(trim(COALESCE(NEW.void_reason,'')))=0 OR NEW.voided_at IS NULL
   OR (to_jsonb(NEW)-ARRAY['state','void_reason','voided_at','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','void_reason','voided_at','version','updated_at'])
  THEN RAISE EXCEPTION 'Issued invoice is immutable' USING ERRCODE='23514'; END IF;
  SELECT * INTO f FROM invoice_financials WHERE id=OLD.id;
  IF f.net_cash_minor<>0 OR f.credit_minor<>0 THEN RAISE EXCEPTION 'Reverse financial events before voiding' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END; $$;
CREATE TABLE cost_revision (
 id uuid PRIMARY KEY,expense_id uuid REFERENCES expense(id),trip_id uuid REFERENCES trip(id),previous_value jsonb NOT NULL,new_value jsonb NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),CHECK(num_nonnulls(expense_id,trip_id)=1)
);
CREATE TRIGGER cost_revision_append_only BEFORE UPDATE OR DELETE ON cost_revision FOR EACH ROW EXECUTE FUNCTION append_only();
ALTER TABLE invoice_line ADD COLUMN charge_snapshot jsonb NOT NULL DEFAULT '[]';
CREATE FUNCTION guard_cost_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Archive cost records; preserve history' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='expense' THEN
  PERFORM id FROM client_charge WHERE expense_id=OLD.id ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM client_charge c JOIN charge_allocation a ON a.charge_id=c.id WHERE c.expense_id=OLD.id AND a.released_at IS NULL) THEN RAISE EXCEPTION 'Allocated expense cannot be changed' USING ERRCODE='23514'; END IF;
 ELSE
  PERFORM id FROM client_charge WHERE trip_id=OLD.id ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM client_charge c JOIN charge_allocation a ON a.charge_id=c.id WHERE c.trip_id=OLD.id AND a.released_at IS NULL) THEN RAISE EXCEPTION 'Allocated trip cannot be changed' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER expense_billing_guard BEFORE UPDATE OR DELETE ON expense FOR EACH ROW EXECUTE FUNCTION guard_cost_record();
CREATE TRIGGER trip_billing_guard BEFORE UPDATE OR DELETE ON trip FOR EACH ROW EXECUTE FUNCTION guard_cost_record();
ALTER TABLE quote ADD CONSTRAINT quote_client_unique UNIQUE(id,client_id);
ALTER TABLE invoice ADD CONSTRAINT invoice_source_quote_client_fk FOREIGN KEY(source_quote_id,client_id) REFERENCES quote(id,client_id);
ALTER TABLE job ADD CONSTRAINT job_source_quote_client_fk FOREIGN KEY(source_quote_id,client_id) REFERENCES quote(id,client_id);
CREATE FUNCTION guard_quote_conversion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.source_quote_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM quote WHERE id=NEW.source_quote_id AND state='accepted') THEN RAISE EXCEPTION 'Only accepted quotes can be converted' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER invoice_quote_conversion BEFORE INSERT ON invoice FOR EACH ROW EXECUTE FUNCTION guard_quote_conversion();
CREATE TRIGGER job_quote_conversion BEFORE INSERT ON job FOR EACH ROW EXECUTE FUNCTION guard_quote_conversion();
