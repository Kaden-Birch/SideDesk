# Vault threat model — implemented M1 format

The pre-implementation review is retained in architecture-decisions.md. This document records actual format v1 and residual risks. No independent audit or certification has been obtained. Actual client secrets are gated on independent review.

## Trust and data flow

One owner authenticates with an Argon2id server-side verifier. Opaque random session tokens are hashed in PostgreSQL. The vault password never participates in login and is never transmitted. Browser crypto is isolated in `features/vault/crypto.ts`; server routes cannot import it. Decrypted objects stay in the Credentials component, never SSR, shared query caches, URLs or persistent browser storage. A browser crypto worker is deferred; components retain a VMK byte array in a ref, scrub it on lock and invalidate in-flight operations using an epoch. This is an explicit implementation tradeoff: no worker or JavaScript mechanism would make compromised same-origin code safe.

Server credential APIs accept strict envelope/payload schemas, no username/password/custom-field columns. Client lists/detail responses omit ciphertext except the dedicated credential endpoint. Labels and client associations are intentionally plaintext. QR images are decoded locally, bounded by size/dimensions, and never uploaded.

## Format v1

All binary fields use canonical Base64. IDs are UUIDs. Canonical AAD/info is UTF-8 JSON of fixed-position arrays. Browser secure context, subtle crypto and secure randomness must all be available; capabilities for clipboard/camera are independent.

- Random 32-byte VMK, random 16-byte vault HKDF salt.
- Password: Argon2id v1.3, 65536 KiB, three iterations, four lanes, 32-byte output; fresh 16-byte salt. HKDF-SHA256 derives wrapping AES key with info `["SideDesk",1,"wrap","password",vaultId,envelopeId]` and envelope salt.
- Recovery: independent random 32-byte secret plus 4-byte SHA256 transcription checksum, encoded as hyphenated hex groups. HKDF-SHA256 derives wrapping AES key using recovery salt and the same info array with `"recovery"` purpose. Checksum is not a password verifier or extra entropy.
- Wrap: AES-256-GCM, fresh random 12-byte nonce, 128-bit tag. AAD `["SideDesk",1,"envelope",vaultId,envelopeId,kind,kdf,salt,memory,iterations,parallelism]`. Recovery metadata retains fixed Argon2 parameter slots for v1 uniform encoding but does not apply Argon2 to a high-entropy recovery secret.
- Record key: HKDF-SHA256(VMK, vault salt, `["SideDesk",1,"credential",vaultId,recordId,1]`). Final `1` is key generation, fixed in M1.
- Record encryption: AES-256-GCM with fresh 12-byte nonce/tag128. AAD `["SideDesk",1,"payload",vaultId,recordId,clientId,1,revisionId]`. Revision ID changes with every encryption. DB nonce registry rejects reuse for the same vault/record key, including after archive. Client reassignment requires authenticated decrypt/re-encrypt.
- Structured plaintext contains username, password, URL, notes, recovery codes, typed custom fields and supported TOTP parameters. Schema validation happens after authentication succeeds; no partial display on error.

Changing the vault password rewraps the same VMK atomically with optimistic versioning. Recovery validates the independent envelope, wraps the same VMK with a new password and a newly confirmed recovery key, and updates both envelopes atomically. Lost response/stale update is surfaced; lock and reload before retry. Generation rotation is not implemented in M1; the staged rotation design in the initial review remains future work. Revoking an envelope cannot erase older copies/backups.

## Threats and controls

| Threat | Implemented control | Residual limitation |
|---|---|---|
| Stolen DB/backups | Browser ciphertext, separate salted Argon2id password wrapping, random recovery key | Weak vault password permits offline guessing; plaintext metadata visible |
| HTTP interception | Strong warning and secure-context gating; no server decryption fallback | HTTP account/business data and delivered code can be intercepted; VPN does not provide TLS integrity |
| XSS/dependency/host compromise | Pinned lockfile, local scripts, nonce CSP, no remote assets, safe Markdown without raw HTML, explicit DTOs | Same-origin malicious JS or compromised endpoint can capture unlock keys/secrets |
| CSRF/DNS rebinding | Exact Host/Origin, session-bound token, HttpOnly SameSite cookies | HTTP lacks confidentiality; external TLS must match operator-configured APP_URL |
| First owner takeover/race | Distinct deployment bootstrap token, installation row lock, singleton owner | Operator must keep bootstrap token private and restrict network exposure |
| Brute force/session theft | Persistent global/per-login throttle, tuned Argon2id, expiry and revocation | Global throttle can temporarily deny owner access; it is deliberately not permanent |
| Tamper/swap | AEAD with record/client identity and envelope KDF context; nonce registry | Malicious host can roll back whole DB/code; no external monotonic trust anchor |
| Unattended browser | Idle/hidden/navigation/logout lock, epoch checks, cross-tab lock channel | Memory/OS clipboard/extensions cannot be guaranteed erased |
| QR input/parser | Local jsQR, bounded file/dimensions, strict otpauth/TOTP parser | Camera permission/browser support varies; file/manual alternatives remain |
| Secret logging | Allowlisted event types, generic server failure codes, no body/stack/parameter logs | Operator-added reverse proxies or instrumentation must also avoid request-body logging |
| Lost data/keys | Confirmed recovery key, rehearsal, consistent backups and restored-ciphertext verification | Both unlock/recovery lost means permanent loss |

CSP permits `wasm-unsafe-eval` for locally bundled Argon2 WASM, nonce-based application scripts and inline CSS for React styling; no production `unsafe-eval` for JavaScript. Development differs for Next.js tooling. No analytics, remote scripts, crash upload or service worker is installed. `hash-wasm`, Web Crypto, OTPAuth and jsQR are dependencies, not proof of cryptographic review. Dependency audit coverage and supported phone memory budgets require independent assessment before real secrets.

Automated tests cover wrong keys, mutation/swapping, ciphertext-only wire/storage, rewrap/recovery, RFC TOTP vectors, session/CSRF races and secure/insecure browser workflows. Best-effort browser reveal/copy audit cannot prove a person did not inspect/copy data otherwise.

## M2 jobs, billing, PDF and private-file boundaries

Jobs, invoice identity, time, rates, PDF contents and ordinary attachments are plaintext business data protected by owner authentication, origin/CSRF checks and private storage. They must never contain automatically extracted vault secrets. No vault payloads or decryption module are imported by billing services. Ordinary HTTP billing remains usable; the existing secure-context vault gate is unchanged.

Attackers may submit forged totals, race allocations/numbers/payments, inject template HTML/URLs, upload active files, guess download IDs or race backup. Server calculations, bounded strict schemas, source/invoice/counter locks, unique indexes and database guards enforce the financial invariants. Idempotent mutations prevent duplicate receipts/issues after network retries. PDF text is escaped; renderer JavaScript and network are disabled; no caller-supplied URL/path is rendered. Rendering limits mitigate owner-triggered resource exhaustion but cannot eliminate it. Chromium runs as the unprivileged container user with its sandbox disabled for portable Docker operation; container isolation is the process boundary. Escaping and the no-script/no-network template are essential controls, not a substitute for patching Chromium. Keep its pinned version updated alongside application dependencies.

Job uploads are bounded binary data stored under random nonpublic names. Download checks owner session, job/file association, regular-file size and hash and avoids symlink following; disposition is attachment with nosniff. Filenames are never storage paths. Archived files remain for historical backup; ordinary files are not vault-encrypted. A malicious document can still harm a vulnerable external viewer after owner download. No inline viewer or malware-scanning guarantee is provided.

Issued snapshots/PDFs are immutable via application and database guards. Original PDF hashes detect accidental mismatch, not a malicious database administrator. Full receipt reversals preserve audit history; zero-net unpaid voids release source work without rewriting the original PDF. Compromised server/database administrators remain able to alter application/data and serve malicious JavaScript. Consistent backups include PDF bytes, job metadata/files and encrypted vault envelopes; restore tests cover their relationships. Independent vault review remains required before real credentials.

## M3 SMTP and financial extensions

SMTP credentials are server-managed secrets, separate from the client-side credential vault. The app must decrypt them to authenticate to the mail server. A dedicated 64-hex-character deployment `SMTP_ENCRYPTION_KEY` protects a versioned AES-256-GCM envelope with random 96-bit nonce and purpose/singleton authenticated context. The key stays outside the database/backup; no fallback to SESSION_SECRET or vault material exists. Missing/wrong/corrupt keys fail closed. Settings API returns a password-presence flag, never envelope or plaintext; logs omit raw transport errors. Host compromise with this deployment key can disclose SMTP credentials; it still cannot directly decrypt a locked client vault. Ordinary HTTP can expose settings/login/business traffic in transit. Existing secure-context vault restrictions are unchanged.

Only owner-configured host/port and verified TLS modes are accepted for authenticated SMTP. A private CA is an operator-mounted deployment file, never an HTTP-supplied arbitrary path. Certificate verification is always enabled. Plain local relay mode cannot transmit credentials. The transport cannot read caller-supplied file/URL attachments; only stored immutable PDF bytes with a verified hash are supplied. Subject/sender/recipient fields are bounded and validated; bodies are plain text. SMTP fixtures use disposable local certificates and fictional recipients.

External mail acceptance cannot share a database transaction. Immutable attempt intent and a stable request key precede submission. A separate append-only accepted/failed/unknown result follows. Crashes or ambiguous sockets leave pending/unknown history; neither is retried automatically. Explicit owner review is required before starting a new attempt. Backups may consistently capture pending intent without final result; restore must not infer failure or resend. A malicious SMTP server or compromised host can still lie about delivery; the UI claims acceptance only.

Quote publication freezes parties, agreed rates/tax components and bytes atomically with numbering. Owner evidence records acceptance; mail events do not. Quote-first/invoice-second locks and unique active conversion links prevent racing replacements. Full expense/travel charge reservations and source locks prevent double billing or silently editing allocated costs. Credits, tax components, refunds and reversals are append-only and bounded under the invoice lock. Original invoices remain immutable; deliberate database-administrator tampering remains outside the auditability guarantee. Receipt files are private ordinary business data and may contain untrusted content; they are downloaded as attachments, not executed inline or treated as encrypted vault secrets.
