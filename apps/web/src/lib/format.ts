export function basename(path: string): string {
  if (!path) {
    return "unknown";
  }

  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

export function formatRelative(iso: string): string {
  const deltaMs = Date.now() - Date.parse(iso);

  if (!Number.isFinite(deltaMs)) {
    return "just now";
  }

  const deltaSeconds = Math.max(1, Math.floor(deltaMs / 1000));

  if (deltaSeconds < 60) {
    return `${deltaSeconds}s ago`;
  }

  const deltaMinutes = Math.floor(deltaSeconds / 60);

  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.floor(deltaMinutes / 60);

  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}

export function shortenIdentifier(value: string, lead = 8, tail = 4): string {
  if (!value) {
    return "unknown";
  }

  if (value.length <= lead + tail + 1) {
    return value;
  }

  return `${value.slice(0, lead)}...${value.slice(-tail)}`;
}

export function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "unknown";
  }

  return new Intl.NumberFormat("en", {
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
    notation: "compact",
  }).format(value);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(date);
}
