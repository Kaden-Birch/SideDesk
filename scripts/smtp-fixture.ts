// Disposable browser-test SMTP only. Never used by production entry points.
import { SMTPServer } from "smtp-server";
import { mkdtemp, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
export async function smtpFixture(root: string) {
  const dir = await mkdtemp(root + "/work/smtp-fixture-");
  await promisify(execFile)("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    dir + "/key.pem",
    "-out",
    dir + "/ca.pem",
    "-days",
    "2",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ]);
  const server = new SMTPServer({
    secure: false,
    key: await readFile(dir + "/key.pem"),
    cert: await readFile(dir + "/ca.pem"),
    logger: false,
    onAuth(auth, _session, done) {
      if (
        auth.username === "browser-fixture-owner" &&
        auth.password === "fictional-browser-smtp-password"
      )
        done(null, { user: "fixture" });
      else
        done(
          Object.assign(new Error("Fictional rejected credentials"), {
            responseCode: 535,
          }),
        );
    },
    onData(stream, _session, done) {
      stream.resume();
      stream.on("end", () => done());
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(3110, "127.0.0.1", resolve);
  });
  return {
    server,
    env: {
      SMTP_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      SMTP_CA_FILE: dir + "/ca.pem",
    },
  };
}
