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
