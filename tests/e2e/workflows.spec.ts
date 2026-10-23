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
  test("Milestone 2 jobs, entry review, invoice editor, PDF snapshots and partial/full payments", async ({
    page,
  }) => {
    await login(page);
    await page.getByRole("button", { name: "Work", exact: true }).click();
    await page.getByRole("button", { name: "Jobs", exact: true }).click();
    await page.getByRole("button", { name: "+ New job", exact: true }).click();
    await page.getByLabel("Job title", { exact: true }).fill("Network refresh");
    await page
      .getByLabel("Description / scope")
      .fill("Fictional office network configuration and handover.");
    await page
      .getByLabel("Job hourly rate override (CAD)", { exact: true })
      .fill("180");
    await page.getByRole("button", { name: "Save job", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Network refresh", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Upload job file").setInputFiles({
      name: "fictional-handover.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Fictional network handover"),
    });
    const attachment = page.getByRole("link", {
      name: "fictional-handover.txt",
      exact: true,
    });
    await expect(attachment).toBeVisible();
    const file = await page.request.get(
      (await attachment.getAttribute("href"))!,
    );
    expect(file.headers()["content-type"]).toBe("application/octet-stream");
    expect(await file.text()).toBe("Fictional network handover");
    await page
      .getByRole("button", { name: "+ Log activity for job", exact: true })
      .click();
    await page.getByLabel("Activity title").fill("Configure office network");
    await page
      .getByLabel("Manual duration (minutes)", { exact: true })
      .fill("25");
    await page
      .getByRole("dialog")
      .getByLabel("Notes", { exact: true })
      .fill("Activity description retained");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByLabel("Description / notes")).toHaveValue(
      "Activity description retained",
    );
    await expect(page.getByRole("cell", { name: /180.00\/h/ })).toBeVisible();
    await page.getByRole("button", { name: "Sales", exact: true }).click();
    await page.getByRole("tab", { name: "Unbilled work", exact: true }).click();
    const row = page
      .getByRole("row")
      .filter({ hasText: "Configure office network" });
    await row
      .getByRole("button", { name: "Review billing", exact: true })
      .click();
    await page
      .getByLabel("Entry hourly rate override (CAD)", { exact: true })
      .fill("195");
    await page
      .getByLabel("Billing correction reason")
      .fill("Agreed site rate for this entry");
    await page
      .getByRole("button", { name: "Save billing review", exact: true })
      .click();
    await expect(row).toContainText("$195.00");
    await row.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Create draft (1 entries)", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Draft invoice", exact: true }),
    ).toBeVisible();
    const draftURL = page.url();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Enable tax rates on invoice lines").check();
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Settings saved");
    await page.getByLabel("Legal / issuer name").fill("Fictional IT Studio");
    await page
      .getByLabel("Issuer address")
      .fill("100 Fictional Street, Edmonton, AB");
    await page
      .getByLabel("Payment instructions", { exact: true })
      .fill("Fictional e-transfer instructions.");
    await page
      .getByRole("button", { name: "Save invoice identity", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Invoice identity");
    await page.goto(draftURL);
    await page.getByLabel("Line 1 tax (%)", { exact: true }).fill("5");
    await page
      .getByLabel("Line 1 tax label", { exact: true })
      .fill("Configured tax");
    await page
      .getByRole("button", { name: "Add manual line", exact: true })
      .click();
    await page
      .getByLabel("Line 2 description", { exact: true })
      .fill("Fictional configured device supply");
    await page.getByLabel("Line 2 quantity", { exact: true }).fill("1.125");
    await page
      .getByLabel("Line 2 unit rate (CAD)", { exact: true })
      .fill("19.99");
    await page.getByLabel("Line 2 discount (%)", { exact: true }).fill("7.5");
    await page.getByLabel("Line 2 tax (%)", { exact: true }).fill("5");
    await page
      .getByLabel("Line 2 tax label", { exact: true })
      .fill("Configured tax");
    await page
      .getByLabel("Customer-visible notes")
      .fill("Thank you - fictional demonstration.");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.locator(".invoice-summary .grand")).toContainText(
      "$124.22",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.locator(".invoice-summary .grand")).toContainText(
      "$124.22",
    );
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: "test-results/invoice-draft-dark.png",
      fullPage: true,
    });
    await page.getByLabel("Theme", { exact: true }).selectOption("light");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: "test-results/invoice-draft-phone.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const preview = await page.request.get(
      (await page
        .getByRole("link", { name: "Preview PDF", exact: true })
        .getAttribute("href"))!,
    );
    expect(preview.ok()).toBe(true);
    expect((await preview.body()).subarray(0, 5).toString()).toBe("%PDF-");
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Issue invoice", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "INV-000001", exact: true }),
    ).toBeVisible();
    const pdfURL = (await page
      .getByRole("link", { name: "Download original PDF", exact: true })
      .getAttribute("href"))!;
    const original = await (await page.request.get(pdfURL)).body();
    await page
      .getByRole("button", { name: "Record payment", exact: true })
      .click();
    await page.getByLabel("Payment amount (CAD)", { exact: true }).fill("50");
    await page
      .getByLabel("Payment reference")
      .fill("Fictional partial receipt");
    await page
      .getByRole("button", { name: "Save payment", exact: true })
      .click();
    await expect(page.locator(".invoice-summary .balance")).toContainText(
      "$74.22",
    );
    expect(
      (await (await page.request.get(pdfURL)).body()).equals(original),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Record payment", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save payment", exact: true })
      .click();
    await expect(page.locator(".invoice-summary .balance")).toContainText(
      "$0.00",
    );
    expect(
      (await (await page.request.get(pdfURL)).body()).equals(original),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/invoice-issued-light.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Sales", exact: true }).click();
    await page.getByRole("tab", { name: "Unbilled work", exact: true }).click();
    await expect(
      page.getByRole("row").filter({ hasText: "Configure office network" }),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: "Payments", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "INV-000001", exact: true }),
    ).toHaveCount(2);
  });
  test("Milestone 2 invoicing and PDF downloads work over ordinary HTTP while the vault stays blocked", async ({
    page,
  }) => {
    await page.goto("http://sidedesk.test:3101");
    await page.getByLabel("Login name").fill(account.name);
    await page
      .getByLabel("Login password", { exact: true })
      .fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Sales", exact: true }).click();
    await page
      .getByRole("button", { name: "+ New invoice", exact: true })
      .click();
    await page
      .getByLabel("Line 1 description", { exact: true })
      .fill("Fictional HTTP service");
    await page.getByLabel("Line 1 unit rate (CAD)", { exact: true }).fill("80");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.locator(".invoice-summary .grand")).toContainText(
      "$80.00",
    );
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Issue invoice", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "INV-000002", exact: true }),
    ).toBeVisible();
    const url = (await page
      .getByRole("link", { name: "Download original PDF", exact: true })
      .getAttribute("href"))!;
    expect(
      await page.evaluate(async (path) => {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`PDF returned ${response.status}`);
        return new TextDecoder().decode(
          (await response.arrayBuffer()).slice(0, 5),
        );
      }, url),
    ).toBe("%PDF-");
    await page
      .getByRole("button", { name: "Credentials", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Vault unavailable in this browser context",
      }),
    ).toBeVisible();
  });
});
