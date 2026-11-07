import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, login, OWNER } from "./helpers";

test.describe("public website", () => {
  test("homepage shows the brand, categories and WhatsApp contact", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Everything you need");
    await expect(page.getByText("Berger Paints").first()).toBeVisible();
    await expect(page.locator('a[href^="https://wa.me/917621934414"]').first()).toBeAttached();
    await expectNoHorizontalScroll(page);
  });

  test("catalogue search finds products and marks sample data", async ({ page }) => {
    await page.goto("/products?q=tank");
    await expect(page.getByText("SAMPLE Triple Layer Water Tank").first()).toBeVisible();
    await expect(page.getByText("SAMPLE DATA").first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("product page shows server prices and a clear demonstration warning", async ({ page }) => {
    await page.goto("/products/sample-interior-emulsion");
    await expect(page.getByText("Demonstration product — not real product information.")).toBeVisible();
    await expect(page.getByText("₹350", { exact: true }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("a visitor sends an order request that staff can see", async ({ page, browser }) => {
    await page.goto("/products/sample-interior-emulsion");
    await page.getByRole("button", { name: /^(Add to cart|Add more to cart)$/ }).click();
    await page.goto("/enquiry");
    await expect(page.getByText("SAMPLE Interior Emulsion").first()).toBeVisible();
    await page.fill("#eq-name", "Ramesh E2E");
    await page.fill("#eq-mobile", "9825012345");
    await page.getByRole("button", { name: /Send order request|Send enquiry/ }).click();
    const success = page.getByText(/has been received/);
    await expect(success).toBeVisible();
    const orderNumber = (await page.locator("span.font-extrabold", { hasText: /^W\d{6}$/ }).first().textContent())?.trim();
    expect(orderNumber).toMatch(/^W\d{6}$/);
    await expectNoHorizontalScroll(page);

    const ctx = await browser.newContext();
    const staff = await ctx.newPage();
    await login(staff, OWNER.username, OWNER.password);
    await staff.goto("/dashboard/orders");
    await expect(staff.getByText(orderNumber!).first()).toBeVisible();
    await ctx.close();
  });

  test("the policy pages are linked from the footer and name the shop", async ({ page }) => {
    await page.goto("/");
    const footer = page.locator("footer");
    for (const [label, heading] of [
      ["Terms of use", "Terms of use"],
      ["Refunds & cancellation", "Refunds & cancellation"],
      ["Pickup & delivery", "Pickup & delivery"],
      ["Privacy policy", "Privacy policy"],
    ]) {
      await footer.getByRole("link", { name: label }).click();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText("Questions about this policy").locator("visible=true")).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
    await expect(page.getByText(/Data Protection Board of India/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Grievance Officer/ })).toBeVisible();
  });

  test("the shop map is embedded wherever customers look for the location", async ({ page }) => {
    for (const path of ["/", "/contact", "/about", "/pickup-policy"]) {
      const res = await page.goto(path);
      expect(res!.headers()["content-security-policy"], path).toContain("frame-src https://www.google.com/maps/embed");
      const frame = page.locator('iframe[src^="https://www.google.com/maps/embed?pb="]');
      await expect(frame, path).toHaveCount(1);
      await expect(frame, path).toHaveAttribute("title", /Map showing where .+ is/);
      await expect(frame, path).toHaveAttribute("loading", "lazy");
      await expect(page.getByRole("link", { name: "Get directions" }).first(), path).toHaveAttribute("href", /google\.com\/maps\/dir\/\?api=1&destination=/);
      await expectNoHorizontalScroll(page);
    }
    // The staff area never allows frames.
    const staff = await page.request.get("/login");
    expect(staff.headers()["content-security-policy"]).not.toContain("frame-src");
  });

  test("a customer's wrong password is an error on their own sign-in page, not the staff login", async ({ page }) => {
    await page.goto("/sign-in");
    await page.fill("#sh-mobile", "9825099999");
    await page.fill("#sh-password", "not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Wrong mobile number or password")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByLabel("Mobile number")).toBeVisible();
  });

  test("an invalid share link shows a friendly page and no data", async ({ page }) => {
    // Streaming pages can't change the HTTP status once the shell is sent; what matters is that
    // nothing is revealed and the page is not indexed.
    await page.goto("/d/this-is-not-a-real-share-token-1234567890");
    await expect(page.getByText(/invalid|withdrawn|not found/i).first()).toBeVisible();
    await expect(page.getByText(/GRAND TOTAL|TAX INVOICE/i)).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    const pdf = await page.request.get("/d/this-is-not-a-real-share-token-1234567890/pdf");
    expect(pdf.status()).toBe(404);
  });
});
