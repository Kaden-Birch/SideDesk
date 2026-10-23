import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const account = {
  name: "demo-owner",
  password: "demo-owner-password-123!",
  setup: "test-bootstrap-token-for-local-tests-only-123456789",
};
async function login(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("Login name")).toBeVisible();
  await page.getByLabel("Login name").fill(account.name);
  await page
    .getByLabel("Login password", { exact: true })
    .fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}
test.describe.serial("Milestone 0 and 1 acceptance", () => {
  const serverErrors = new WeakMap<Page, string[]>();
  test.beforeEach(async ({ page }) => {
    const failures: string[] = [];
    serverErrors.set(page, failures);
    page.on("response", (r) => {
      if (r.url().includes("/api/") && r.status() >= 500)
        failures.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
  });
  test.afterEach(async ({ page }) => {
    expect(serverErrors.get(page) || []).toEqual([]);
  });

  test("owner onboarding, real clients and work in both themes and phone layout", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Create your workspace" }),
    ).toBeVisible();
    await expect(
      page.getByText("SideDesk will never disable encryption", {
        exact: false,
      }),
    ).toBeVisible();
    await page.getByLabel("Login name").fill(account.name);
    await page
      .getByLabel("Login password", { exact: true })
      .fill(account.password);
    await page.getByLabel("One-use setup token").fill(account.setup);
    await page
      .getByLabel("Business or personal name")
      .fill("Fictional IT Studio");
    await page.getByLabel("Default hourly rate").fill("120");
    await page
      .getByRole("button", { name: "Create owner & workspace" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    await page
      .getByRole("button", { name: "+ Add client", exact: true })
      .click();
    await page.getByLabel("Client name").fill("Prairie Demo Studio");
    await page
      .getByLabel("Email", { exact: true })
      .fill("demo@example.invalid");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Prairie Demo Studio", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Add contact", exact: true })
      .click();
    await page.getByLabel("Contact name").fill("Demo Contact");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Demo Contact", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await page
      .getByLabel("Note", { exact: true })
      .fill("**Important context**\n<script>window.UNSAFE=true</script>");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Important context", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => "UNSAFE" in window)).toBe(false);
    await page
      .getByRole("button", { name: "+ Log activity", exact: true })
      .click();
    await page.getByLabel("Activity title").fill("Review workstation");
    await page.getByLabel("Manual duration").fill("25");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Review workstation", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "00:25:00", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Start timer", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page
      .getByRole("button", { name: "Stop & save", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Stop & save", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: "test-results/work-dark-desktop.png",
      fullPage: true,
    });
    await page.getByLabel("Theme", { exact: true }).selectOption("light");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: "test-results/work-light-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "test-results/work-light-phone.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
  test("browser vault, custom fields/TOTP, real copy failure, lock, rewrap and recovery rehearsal", async ({
    page,
  }) => {
    await page.clock.install();
    await login(page);
    await page
      .getByRole("button", { name: "Credentials", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Create vault", exact: true })
      .click();
    await expect(page.locator(".recovery-key")).toHaveText(/^[a-f0-9-]{80}$/);
    const key = await page.locator(".recovery-key").innerText();
    await page
      .getByLabel("New vault password", { exact: true })
      .fill("separate-vault-password-123!");
    await page
      .getByLabel("Confirm vault password", { exact: true })
      .fill("separate-vault-password-123!");
    await page.getByLabel("Confirm the complete new recovery key").fill(key);
    await page
      .getByRole("button", { name: "Save encrypted envelopes" })
      .click();
    await expect(
      page.getByRole("button", { name: "New credential", exact: true }),
    ).toBeVisible();
    const bodies: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/")) bodies.push(r.postData() || "");
    });
    await page
      .getByRole("button", { name: "New credential", exact: true })
      .click();
    await page.getByLabel("Credential title").fill("Demo router");
    await page
      .getByLabel("Username / email", { exact: true })
      .fill("KNOWN_BROWSER_USERNAME_7429");
    await page
      .getByLabel("Password", { exact: true })
      .fill("KNOWN_BROWSER_PASSWORD_7429");
    await page
      .getByRole("button", { name: "Add custom field", exact: true })
      .click();
    await page.getByLabel("Field label").fill("PIN");
    await page.getByLabel("Field value").fill("KNOWN_BROWSER_CUSTOM_7429");
    await page.getByLabel("TOTP Base32 secret").fill("JBSWY3DPEHPK3PXP");
    await page
      .getByRole("button", { name: "Add authenticator", exact: true })
      .click();
    await page.getByRole("button", { name: "Encrypt and save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(bodies.join("")).not.toContain("KNOWN_BROWSER_");
    expect(bodies.join("")).not.toContain("JBSWY3DPEHPK3PXP");
    await page
      .getByRole("button", { name: "Demo router", exact: true })
      .click();
    await expect(
      page.getByText("KNOWN_BROWSER_PASSWORD_7429", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Reveal", exact: true })
      .first()
      .click();
    await expect(
      page.getByText("KNOWN_BROWSER_PASSWORD_7429", { exact: true }),
    ).toBeVisible();
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () =>
            Promise.reject(new DOMException("Denied", "NotAllowedError")),
        },
      }),
    );
    await page
      .getByRole("button", { name: "Copy", exact: true })
      .first()
      .click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "Copy failed",
    );
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Test recovery key", exact: true })
      .click();
    await page.getByLabel("Existing recovery key").fill(key);
    await page.getByRole("button", { name: "Run rehearsal" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Recovery rehearsal passed",
    );
    await page
      .getByRole("button", { name: "Change vault password", exact: true })
      .click();
    await page
      .getByLabel("New vault password", { exact: true })
      .fill("replacement-vault-password-123!");
    await page
      .getByLabel("Confirm vault password", { exact: true })
      .fill("replacement-vault-password-123!");
    await page
      .getByRole("button", { name: "Save encrypted envelopes" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Lock vault", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Unlock your vault" }),
    ).toBeVisible();
    await page
      .getByLabel("Vault password", { exact: true })
      .fill("separate-vault-password-123!");
    await page
      .getByRole("button", { name: "Unlock vault", exact: true })
      .click();
    await expect(page.locator("#main").getByRole("alert")).toContainText(
      "Unlock failed",
    );
    await page
      .getByLabel("Vault password", { exact: true })
      .fill("replacement-vault-password-123!");
    await page
      .getByRole("button", { name: "Unlock vault", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "New credential", exact: true }),
    ).toBeVisible();
    const storage = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }));
    expect(JSON.stringify(storage)).not.toMatch(
      /KNOWN_BROWSER_|password-123|JBSWY3/,
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Unlock your vault" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Use recovery key", exact: true })
      .click();
    await expect(page.locator(".recovery-key")).toHaveText(/^[a-f0-9-]{80}$/);
    const nextKey = await page.locator(".recovery-key").innerText();
    await page.getByLabel("Existing recovery key").fill(key);
    await page
      .getByLabel("New vault password", { exact: true })
      .fill("recovered-vault-password-123!");
    await page
      .getByLabel("Confirm vault password", { exact: true })
      .fill("recovered-vault-password-123!");
    await page
      .getByLabel("Confirm the complete new recovery key")
      .fill(nextKey);
    await page
      .getByRole("button", { name: "Save encrypted envelopes" })
      .click();
    await expect(
      page.getByRole("button", { name: "New credential", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Demo router", exact: true })
      .click();
    await expect(
      page.getByText("KNOWN_BROWSER_USERNAME_7429", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.clock.fastForward(6 * 60 * 1000);
    await expect(
      page.getByRole("heading", { name: "Unlock your vault" }),
    ).toBeVisible();
    await page
      .getByLabel("Vault password", { exact: true })
      .fill("recovered-vault-password-123!");
    await page
      .getByRole("button", { name: "Unlock vault", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "New credential", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      const c = new BroadcastChannel("sidedesk-vault-lock");
      c.postMessage("lock");
      c.close();
    });
    await expect(
      page.getByRole("heading", { name: "Unlock your vault" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Sign in to SideDesk" }),
    ).toBeVisible();
    await login(page);
    await page
      .getByRole("button", { name: "Credentials", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Unlock your vault" }),
    ).toBeVisible();
  });
  test("non-loopback HTTP keeps ordinary work usable and disables vault without downgrade", async ({
    page,
  }) => {
    await page.goto("http://sidedesk.test:3101");
    await page.getByLabel("Login name").fill(account.name);
    await page
      .getByLabel("Login password", { exact: true })
      .fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => isSecureContext)).toBe(false);
    await page.getByRole("button", { name: "Clients", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Prairie Demo Studio", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Work", exact: true }).click();
    await page
      .getByRole("button", { name: "+ New activity", exact: true })
      .click();
    await page.getByLabel("Activity title").fill("Work over ordinary HTTP");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Work over ordinary HTTP",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Start timer", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Stop & save", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Stop & save", exact: true }),
    ).toHaveCount(0);

    await page
      .getByRole("button", { name: "Credentials", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Vault unavailable in this browser context",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Unlock vault", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "New credential", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("Demo router", { exact: true })).toBeVisible();
  });
});
