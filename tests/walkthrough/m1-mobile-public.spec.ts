import { check, expect, finish, noSideScroll, pause, say, setup, tap, test, titleCard, type } from "./kit";

setup();

test("M1 · Public website on a phone", async ({ page }) => {
  await page.goto("/");
  await titleCard(page, "M1", "Website on a phone", "The same catalogue on a mobile phone: menu, search, product, enquiry list — no sideways scrolling.");
  await say(page, "Home page on a phone.");
  await check(page, "Fits the screen", () => noSideScroll(page));
  await page.mouse.wheel(0, 900);
  await pause(page, 1500);
  await say(page, "The menu.");
  await tap(page.getByRole("button", { name: "Open menu" }));
  await check(page, "Menu opens with categories", () => expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible());
  await pause(page, 1200);
  await tap(page.getByRole("dialog", { name: "Menu" }).getByRole("button", { name: "Close menu" }).last());
  await say(page, "Search for a tank.");
  await page.goto("/products?q=tank");
  await check(page, "Search result fits the phone", async () => {
    await expect(page.getByText("SAMPLE Triple Layer Water Tank").filter({ visible: true }).first()).toBeVisible();
    await noSideScroll(page);
  });
  await say(page, "Product page: choose a size and add to the enquiry list.");
  await page.goto("/products/sample-interior-emulsion");
  await tap(page.getByRole("button", { name: "10 L", exact: true }));
  await tap(page.getByRole("button", { name: /^(Add to cart|Add more to cart)$/ }));
  await check(page, "Added on the phone", () => expect(page.getByRole("link", { name: /Cart, [1-9]/ }).filter({ visible: true }).first()).toBeVisible());
  await page.goto("/enquiry");
  await check(page, "Enquiry page fits the phone", () => noSideScroll(page));
  await type(page.locator("#eq-name"), "Kalpesh");
  await type(page.locator("#eq-mobile"), "9876512345");
  await tap(page.getByRole("button", { name: /Send order request|Send enquiry/ }));
  await check(page, "Order request sent from the phone", () => expect(page.getByText(/has been received/)).toBeVisible());
  await finish(page);
});
