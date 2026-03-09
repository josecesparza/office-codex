import pino from "pino";
import { describe, expect, it } from "vitest";

import { readAccountUsageStatus } from "../src/account-usage.js";

describe("readAccountUsageStatus", () => {
  it("returns unavailable when no state database is present", async () => {
    await expect(readAccountUsageStatus(null, pino({ level: "silent" }))).resolves.toEqual({
      status: "unavailable",
      source: "state-db-missing",
    });
  });
});
