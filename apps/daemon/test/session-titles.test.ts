import { describe, expect, it } from "vitest";

import {
  deriveTitleFromPromptText,
  looksLikeMachineTitle,
  pickPreferredTitle,
} from "../src/session-titles.js";

describe("session-titles", () => {
  it("derives a short human title from the first user message", () => {
    expect(
      deriveTitleFromPromptText(
        "Create a local dashboard for Codex sessions and keep the UI lightweight.",
      ),
    ).toBe("Create a local dashboard for Codex sessions and keep the UI lightweight");
  });

  it("strips skill prefixes, urls and markdown noise", () => {
    expect(
      deriveTitleFromPromptText(
        "[$skill](foo) **Investigate** why this fails in prod. See https://example.com/logs",
      ),
    ).toBe("Investigate why this fails in prod");
  });

  it("prefers human titles over machine ids", () => {
    expect(looksLikeMachineTitle("019cd46b-7904-71a2-a937-d8ad8d389000")).toBe(true);
    expect(
      pickPreferredTitle("019cd46b-7904-71a2-a937-d8ad8d389000", "Create Office Codex dashboard"),
    ).toBe("Create Office Codex dashboard");
  });
});
