// Shared by the browser tests that add last year's four files to the six.
import { expect } from "@playwright/test";
import { pastFiles } from "../unit/past-fixture.mjs";
import { buildButton, schoolFiles } from "./helpers.mjs";

export const tenFiles = () => [...schoolFiles(), ...pastFiles];

// Through the file input; Build is unlocked when it returns.
export async function dropTen(page) {
  await page.goto("/");
  await page.locator('[data-k="files"]').setInputFiles(tenFiles());
  await expect(buildButton(page)).toBeEnabled();
}
