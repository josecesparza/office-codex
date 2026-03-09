import { expect, test } from "@playwright/test";

test("renders the dashboard with a mocked Codex session", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Pixel dashboard for your local Codex sessions" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mock Dashboard Session" })).toBeVisible();
  await expect(page.getByText("Waiting")).toBeVisible();
});
