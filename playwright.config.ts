import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--host-resolver-rules=MAP sidedesk.test 127.0.0.1",
        "--no-proxy-server",
      ],
    },
  },
  webServer: {
    command: "npx tsx scripts/test-server.ts",
    url: "http://localhost:3100",
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
