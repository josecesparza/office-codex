const MAX_TITLE_LENGTH = 72;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripUrls(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "").trim();
}

function stripSkillPrefix(value: string): string {
  return value.replace(/^\[\$[^\]]+\]\([^)]+\)\s*/i, "").trim();
}

function stripMarkdownPunctuation(value: string): string {
  return value.replace(/[`*_#>]+/g, "").trim();
}

function trimTitle(value: string): string {
  if (value.length <= MAX_TITLE_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function looksLikeMachineTitle(title: string | null | undefined): boolean {
  if (!title) {
    return true;
  }

  const normalized = collapseWhitespace(title);

  if (!normalized) {
    return true;
  }

  if (/^[0-9a-f]{8,}-[0-9a-f-]{8,}$/i.test(normalized)) {
    return true;
  }

  if (normalized.length > 96) {
    return true;
  }

  if (normalized.includes("\n") || /https?:\/\//i.test(normalized)) {
    return true;
  }

  return false;
}

export function deriveTitleFromPromptText(prompt: string | null | undefined): string | null {
  if (!prompt) {
    return null;
  }

  const normalized = collapseWhitespace(
    stripMarkdownPunctuation(stripUrls(stripSkillPrefix(prompt))),
  );

  if (!normalized) {
    return null;
  }

  const firstSentence = normalized.split(/[.!?](?:\s|$)/, 1)[0]?.trim() ?? normalized;
  const candidate = firstSentence.length >= 10 ? firstSentence : normalized;

  return trimTitle(candidate);
}

export function pickPreferredTitle(
  currentTitle: string | null | undefined,
  incomingTitle: string | null | undefined,
): string {
  const normalizedCurrent = collapseWhitespace(currentTitle ?? "");
  const normalizedIncoming = collapseWhitespace(incomingTitle ?? "");

  if (!normalizedIncoming) {
    return normalizedCurrent || "";
  }

  if (!normalizedCurrent) {
    return normalizedIncoming;
  }

  const currentMachine = looksLikeMachineTitle(normalizedCurrent);
  const incomingMachine = looksLikeMachineTitle(normalizedIncoming);

  if (currentMachine && !incomingMachine) {
    return normalizedIncoming;
  }

  if (!currentMachine && incomingMachine) {
    return normalizedCurrent;
  }

  if (incomingMachine && normalizedIncoming.length > normalizedCurrent.length) {
    return normalizedCurrent;
  }

  return normalizedIncoming;
}
