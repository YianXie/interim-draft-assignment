import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { BUDGETS, INSPECT } from "../e2e/measure-source.mjs";

test("BUDGETS and INSPECT are unchanged", () => {
  const { sha256 } = JSON.parse(readFileSync(new URL("../e2e/lock.json", import.meta.url), "utf8"));
  assert.equal(createHash("sha256").update(JSON.stringify(BUDGETS) + "\n" + INSPECT).digest("hex"), sha256);
});
