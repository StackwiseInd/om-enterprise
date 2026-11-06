import { check, expect, finish, pause, say, setup, tap, test, titleCard, type } from "./kit";

setup();

test("02 · Public website: catalogue, search, product, enquiry & order request", async ({ page }) => {
  await page.goto("/");
  await titleCard(page, "02", "Public website", "What customers see: home, categories, catalogue search and filters, product variants and prices, the enquiry list and an order request.");

  await say(page, "Home page: brand, address, phone and WhatsApp at the top.");
  await check(page, "Home page heading", () => expect(page.getByRole("heading", { level: 1 })).toContainText("Everything you need"));
  await check(page, "WhatsApp link to 7621934414", () => expect(page.locator('a[href^="https://wa.me/917621934414"]').first()).toBeAttached());
  await check(page, "Address shown", () => expect(page.getByText("Nr. Shivani Showroom, Bodeli Road").filter({ visible: true }).first()).toBeVisible());

  await say(page, "Shop by category: every category the shop sells.");
  await page.getByRole("heading", { name: "Shop by category" }).scrollIntoViewIfNeeded();
  await pause(page, 1500);
  await tap(page.getByRole("link", { name: /Berger Paints Interior/ }));
  await page.waitForURL(/\/category\/berger-paints/);
  await check(page, "Category page lists its products", () => expect(page.getByText("SAMPLE Interior Emulsion").filter({ visible: true }).first()).toBeVisible());

  await say(page, "Catalogue search — e.g. 'tank'.");
  await page.goto("/products");
  await type(page.getByRole("main").getByRole("searchbox", { name: "Search products" }), "tank");
  await tap(page.getByRole("main").getByRole("button", { name: "Search" }));
  await check(page, "Search finds the water tank", () => expect(page.getByText("SAMPLE Triple Layer Water Tank").filter({ visible: true }).first()).toBeVisible());
  await check(page, "Demonstration items are labelled SAMPLE DATA", () => expect(page.getByText("SAMPLE DATA").filter({ visible: true }).first()).toBeVisible());

  await say(page, "Filter by category and sort.");
  await page.goto("/products");
  await page.getByRole("combobox", { name: "Category" }).selectOption({ label: "CPVC Pipes & Fittings" }).catch(async () => {
    const opts = await page.getByRole("combobox", { name: "Category" }).locator("option").allTextContents();
    await page.getByRole("combobox", { name: "Category" }).selectOption({ label: opts.find((o) => o.includes("CPVC"))! });
  });
  await pause(page, 1500);
  await check(page, "Category filter shows CPVC items", () => expect(page.getByText(/SAMPLE CPVC/).filter({ visible: true }).first()).toBeVisible());

  await say(page, "A product page: variants (pack sizes), server-side prices and a clear demonstration warning.");
  await page.goto("/products/sample-interior-emulsion");
  await check(page, "Demonstration warning shown", () => expect(page.getByText("Demonstration product — not real product information.")).toBeVisible());
  await check(page, "1 L price ₹350", () => expect(page.getByText("₹350", { exact: true }).filter({ visible: true }).first()).toBeVisible());
  await tap(page.getByRole("button", { name: "4 L", exact: true }));
  await check(page, "Choosing 4 L shows its own price ₹1,290", () => expect(page.getByText("₹1,290", { exact: true }).filter({ visible: true }).first()).toBeVisible());

  await say(page, "Add two of them to the enquiry list.");
  await tap(page.getByRole("button", { name: "Increase quantity" }));
  await tap(page.getByRole("button", { name: /^(Add to cart|Add more to cart)$/ }));
  await check(page, "Cart counter updates", () => expect(page.getByRole("link", { name: /Cart, [1-9]/ }).filter({ visible: true }).first()).toBeVisible());

  await say(page, "The enquiry page: the customer's list, and a form to send it as an order request.");
  await page.goto("/enquiry");
  await check(page, "Item is in the enquiry list", () => expect(page.getByText("SAMPLE Interior Emulsion").filter({ visible: true }).first()).toBeVisible());
  await type(page.locator("#eq-name"), "Ramesh Patel");
  await type(page.locator("#eq-mobile"), "9825012345");
  await tap(page.getByRole("button", { name: /Send order request|Send enquiry/ }));
  await check(page, "Order request received with a number", () => expect(page.getByText(/has been received/)).toBeVisible());
  await pause(page, 1500);

  await say(page, "About and Contact pages, with map, phone and WhatsApp.");
  await page.goto("/about");
  await check(page, "About page", () => expect(page.getByRole("heading", { level: 1 })).toBeVisible());
  await pause(page, 1200);
  await page.goto("/contact");
  await check(page, "Contact page shows the phone number", () => expect(page.getByText("+91 76219 34414").filter({ visible: true }).first()).toBeVisible());
  await pause(page, 1200);

  await say(page, "Unknown addresses get a friendly 'not listed' page.");
  await page.goto("/products/does-not-exist");
  await check(page, "Friendly not-found page", () => expect(page.getByRole("heading", { name: "This item isn't listed" })).toBeVisible());

  await say(page, "Bill share links that are wrong or withdrawn reveal nothing.");
  await page.goto("/d/this-is-not-a-real-share-token-1234567890");
  await check(page, "Invalid bill link shows no data", async () => {
    await expect(page.getByText(/invalid|withdrawn|not found/i).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(/GRAND TOTAL|TAX INVOICE/i)).toHaveCount(0);
  });
  await check(page, "Staff pages are hidden from search engines", async () => {
    const robots = await (await page.request.get("/robots.txt")).text();
    expect(robots).toContain("Disallow: /dashboard");
    expect(robots).toContain("Disallow: /admin");
  });
  await finish(page);
});
