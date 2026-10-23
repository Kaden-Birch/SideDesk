import { cp, mkdir, access } from "node:fs/promises";
await mkdir(".next/standalone/.next", { recursive: true });
await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
try {
  await access("public");
  await cp("public", ".next/standalone/public", { recursive: true });
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
// Next's static tracing omits Playwright metadata loaded at runtime.
// Ship the complete pinned renderer packages in the standalone distribution.
for (const pkg of ["playwright", "playwright-core", "nodemailer"]) {
  await cp("node_modules/" + pkg, ".next/standalone/node_modules/" + pkg, {
    recursive: true,
  });
}
