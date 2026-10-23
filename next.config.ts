import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: [
    "@node-rs/argon2",
    "playwright",
    "playwright-core",
    "nodemailer",
  ],
};
export default config;
