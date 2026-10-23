import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const account = {
  name: "demo-owner",
  password: "demo-owner-password-123!",
  setup: "test-bootstrap-token-for-local-tests-only-123456789",
};
async function login(page: Page, url = "/") {
  await page.goto(url);
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
  test("Milestone 3 quote tax snapshots, SMTP outcomes, conversion and auditable credits/refunds", async ({
    page,
  }) => {
    await login(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "New tax profile", exact: true })
      .click();
    await page
      .getByLabel("Tax profile name", { exact: true })
      .fill("Fictional combined tax");
    await page
      .getByLabel("Tax component 1 label", { exact: true })
      .fill("Configured GST");
    await page
      .getByLabel("Tax component 1 rate (%)", { exact: true })
      .fill("5");
    await page
      .getByRole("button", { name: "Add tax component", exact: true })
      .click();
    await page
      .getByLabel("Tax component 2 label", { exact: true })
      .fill("Configured QST");
    await page
      .getByLabel("Tax component 2 rate (%)", { exact: true })
      .fill("9.975");
    await page
      .getByRole("button", { name: "Save tax profile", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    async function configureSMTP(password: string) {
      await page.getByLabel("SMTP host", { exact: true }).fill("127.0.0.1");
      await page.getByLabel("SMTP port", { exact: true }).fill("3110");
      await page
        .getByLabel("SMTP transport security", { exact: true })
        .selectOption("starttls");
      await page
        .getByLabel("SMTP username", { exact: true })
        .fill("browser-fixture-owner");
      await page.getByLabel("SMTP password", { exact: true }).fill(password);
      await page
        .getByLabel("Sender email", { exact: true })
        .fill("owner@example.invalid");
      await page
        .getByLabel("Sender name", { exact: true })
        .fill("Fictional Prairie Studio");
      await page
        .getByRole("button", { name: "Save SMTP settings", exact: true })
        .click();
      await expect(
        page.getByLabel("SMTP password", { exact: true }),
      ).toHaveValue("");
    }
    await configureSMTP("wrong-fictional-password");
    await page.getByRole("button", { name: "Sales", exact: true }).click();
    await page.getByRole("button", { name: "Quotes", exact: true }).click();
    await page
      .getByRole("button", { name: "+ New quote", exact: true })
      .click();
    await page
      .getByLabel("Quote line 1 description", { exact: true })
      .fill("Fictional installation service");
    await page
      .getByLabel("Quote line 1 unit rate (CAD)", { exact: true })
      .fill("100");
    await page
      .getByLabel("Quote line 1 tax treatment", { exact: true })
      .selectOption({ label: "Fictional combined tax" });
    await page
      .getByLabel("Quote terms", { exact: true })
      .fill("Fictional scope accepted in writing.");
    await page
      .getByRole("button", { name: "Save quote draft", exact: true })
      .click();
    await expect(page.locator(".invoice-summary .grand")).toContainText(
      "$114.98",
    );
    await page
      .getByRole("button", { name: "Save quote draft", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Publish quote", exact: true }),
    ).toBeEnabled();
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Publish quote", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "QUO-000001", exact: true }),
    ).toBeVisible();
    const quoteURL = page.url();
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      window.scrollTo(0, 0);
    });
    await expect(page.locator(".toast")).toHaveCount(0);
    await page.screenshot({
      path: "test-results/quote-published-dark.png",
      fullPage: true,
    });
    await page.getByLabel("Theme", { exact: true }).selectOption("light");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: "test-results/quote-published-phone.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    async function email() {
      await page
        .getByRole("button", { name: "Email PDF", exact: true })
        .click();
      await page
        .getByLabel("Email recipient", { exact: true })
        .fill("client@example.invalid");
      await page
        .getByLabel("I reviewed the recipient and existing email history.", {
          exact: true,
        })
        .check();
      await page.getByRole("button", { name: "Send PDF", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await email();
    await expect(page.getByText("failed", { exact: true })).toBeVisible();
    await expect(page.locator(".page-heading .tag")).toHaveText("published");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await configureSMTP("fictional-browser-smtp-password");
    await page
      .getByRole("button", { name: "Test saved SMTP connection", exact: true })
      .click();
    await expect(
      page.getByText(
        "SMTP connection and configured authentication accepted. No email was sent.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.goto(quoteURL);
    await expect(
      page.getByRole("heading", { name: "QUO-000001", exact: true }),
    ).toBeVisible();
    await email();
    await expect(page.locator(".page-heading .tag")).toHaveText("sent");
    await page
      .getByRole("button", { name: "Record acceptance", exact: true })
      .click();
    await page
      .getByLabel("Quote decision evidence or reason", { exact: true })
      .fill("Fictional written approval received.");
    await page
      .getByRole("button", { name: "Confirm quote decision", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Create invoice from quote",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Create job from quote", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Work from QUO-000001", exact: true }),
    ).toBeVisible();
    await page.goto(quoteURL);
    await page
      .getByRole("button", { name: "Create invoice from quote", exact: true })
      .click();
    await expect(
      page.getByText("Saved invoice lines match the accepted quote.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".invoice-summary .grand")).toContainText(
      "$114.98",
    );
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Issue invoice", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "INV-000003", exact: true }),
    ).toBeVisible();
    const pdfURL = (await page
      .getByRole("link", { name: "Download original PDF", exact: true })
      .getAttribute("href"))!;
    const before = await (await page.request.get(pdfURL)).body();
    await page
      .getByRole("button", { name: "Record payment", exact: true })
      .click();
    await page.getByLabel("Payment amount (CAD)", { exact: true }).fill("100");
    await page
      .getByRole("button", { name: "Save payment", exact: true })
      .click();
    await page.getByRole("button", { name: "Add credit", exact: true }).click();
    await page.getByLabel("Credit amount (CAD)", { exact: true }).fill("30");
    await page
      .getByLabel("Adjustment reason", { exact: true })
      .fill("Fictional agreed service reduction.");
    await page
      .getByRole("button", { name: "Record credit", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Record refund", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Record refund", exact: true })
      .click();
    await page.getByLabel("Refund amount (CAD)", { exact: true }).fill("15.02");
    await page
      .getByLabel("Adjustment reason", { exact: true })
      .fill("Fictional cash refund already returned.");
    await page
      .getByLabel("The money was returned outside SideDesk.", { exact: true })
      .check();
    await page
      .getByRole("button", { name: "Confirm recorded refund", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".page-heading .tag")).toHaveText("settled");
    expect((await (await page.request.get(pdfURL)).body()).equals(before)).toBe(
      true,
    );
    for (const kind of ["refund", "credit"]) {
      await page
        .getByRole("button", { name: "Reverse " + kind, exact: true })
        .click();
      await page
        .getByLabel("Adjustment reason", { exact: true })
        .fill("Fictional " + kind + " bookkeeping correction.");
      await page
        .getByRole("button", { name: "Confirm reversal", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await page
      .getByRole("button", { name: "Reverse receipt", exact: true })
      .click();
    await page
      .getByLabel("Correction reason", { exact: true })
      .fill("Fictional receipt did not occur.");
    await page
      .getByRole("button", { name: "Confirm receipt reversal", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Void invoice", exact: true })
      .click();
    await page
      .getByLabel("Correction reason", { exact: true })
      .fill("Fictional void after corrected financial events.");
    await page
      .getByRole("button", { name: "Confirm void", exact: true })
      .click();
    await expect(page.locator(".page-heading .tag")).toHaveText("void");
    await expect(
      page.getByRole("button", { name: "Email PDF", exact: true }),
    ).toBeDisabled();
    const ledger = page.locator("section.card").filter({
      has: page.getByRole("heading", {
        name: "Credits & refunds",
        exact: true,
      }),
    });
    await expect(
      ledger.getByText("Fictional agreed service reduction.", { exact: true }),
    ).toBeVisible();
    expect((await (await page.request.get(pdfURL)).body()).equals(before)).toBe(
      true,
    );
    await page.goto(quoteURL);
    await page
      .getByRole("button", { name: "Create invoice from quote", exact: true })
      .click();
    await expect(
      page.getByText("Saved invoice lines match the accepted quote.", {
        exact: true,
      }),
    ).toBeVisible();
  });
  test("Milestone 3 expenses, private receipts and mileage/time charges work on ordinary HTTP", async ({
    page,
  }) => {
    await login(page, "http://sidedesk.test:3101");
    await page.getByRole("button", { name: "Expenses", exact: true }).click();
    await page
      .getByRole("button", { name: "+ New expense", exact: true })
      .click();
    await page
      .getByLabel("Expense vendor", { exact: true })
      .fill("Fictional parts supplier");
    await page
      .getByLabel("Expense total including tax (CAD)", { exact: true })
      .fill("105");
    await page
      .getByLabel("Tax included in expense (CAD)", { exact: true })
      .fill("5");
    await page
      .getByLabel("Expense description", { exact: true })
      .fill("Fictional replacement cable");
    await page
      .getByLabel("Cost client (optional)", { exact: true })
      .selectOption({ label: "Prairie Demo Studio" });
    await page
      .getByLabel("Cost job (optional)", { exact: true })
      .selectOption({ label: "Work from QUO-000001" });
    await page
      .getByLabel("Create a separate billable recovery charge", { exact: true })
      .check();
    await page
      .getByLabel("Customer recovery amount before invoice tax (CAD)", {
        exact: true,
      })
      .fill("120");
    await page
      .getByRole("button", { name: "Save expense", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Fictional parts supplier",
        exact: true,
      }),
    ).toBeVisible();
    const expenseURL = page.url();
    await page
      .getByLabel("Upload expense receipt", { exact: true })
      .setInputFiles({
        name: "fictional-receipt.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Fictional receipt total CAD 105.00"),
      });
    await expect(
      page.getByRole("link", { name: "fictional-receipt.txt", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("New expense note", { exact: true })
      .fill("**Fictional** receipt checked.");
    await page
      .getByRole("button", { name: "Add expense note", exact: true })
      .click();
    await expect(page.locator(".markdown")).toContainText("receipt checked.");
    await page.getByRole("button", { name: "+ New trip", exact: true }).click();
    await page
      .getByLabel("Trip purpose", { exact: true })
      .fill("Fictional service trip");
    await page.getByLabel("Distance (km)", { exact: true }).fill("10.125");
    await page
      .getByLabel("Travel duration (minutes)", { exact: true })
      .fill("12");
    await page
      .getByLabel("Customer mileage rate (CAD/km)", { exact: true })
      .fill("0.70");
    await page
      .getByLabel("Customer travel labour rate (CAD/hour)", { exact: true })
      .fill("100");
    await page
      .getByLabel("Travel time rounding (minutes)", { exact: true })
      .selectOption("15");
    await page
      .getByLabel("Cost client (optional)", { exact: true })
      .selectOption({ label: "Prairie Demo Studio" });
    await page
      .getByLabel("Cost job (optional)", { exact: true })
      .selectOption({ label: "Work from QUO-000001" });
    await page
      .getByLabel("Create a billable mileage charge", { exact: true })
      .check();
    await page
      .getByLabel("Create a separate billable travel labour charge", {
        exact: true,
      })
      .check();
    await page.getByRole("button", { name: "Save trip", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Fictional service trip",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "View unbilled charges", exact: true })
      .click();
    await page
      .getByLabel("Select charge Fictional replacement cable", { exact: true })
      .check();
    await page
      .getByLabel("Select charge Mileage - Fictional service trip", {
        exact: true,
      })
      .check();
    await page
      .getByLabel("Select charge Travel time - Fictional service trip", {
        exact: true,
      })
      .check();
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByLabel("Theme", { exact: true }).selectOption("light");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      window.scrollTo(0, 0);
    });
    await expect(page.locator(".toast")).toHaveCount(0);
    await page.screenshot({
      path: "test-results/expense-charges-phone.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Create draft from charges", exact: true })
      .click();
    await expect(page.locator(".invoice-summary .grand")).toContainText(
      "$152.09",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Issue invoice", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "INV-000004", exact: true }),
    ).toBeVisible();
    await page.goto(expenseURL);
    await expect(
      page.getByRole("button", { name: "Edit expense", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Open linked job", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /Fictional parts supplier.*cost/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Fictional service trip.*km/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Credentials", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Vault unavailable in this browser context",
        exact: true,
      }),
    ).toBeVisible();
  });
});
