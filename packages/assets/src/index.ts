import type { OfficeLayout } from "@office-codex/core";

export const officePalette = {
  background: "#f8f4ea",
  floor: "#d5c6a5",
  wall: "#4f4a45",
  desk: "#a47148",
  deskShadow: "#6b4b34",
  accent: "#2b6cb0",
  overflow: "#efe2c5",
  text: "#201a15",
  textMuted: "#6f6258",
} as const;

export const agentPalette = [
  "#2b6cb0",
  "#d97706",
  "#0f766e",
  "#c2410c",
  "#7c3aed",
  "#b91c1c",
  "#0891b2",
  "#6d28d9",
] as const;

export const defaultOfficeLayout: OfficeLayout = {
  tileSize: 16,
  width: 16,
  height: 10,
  desks: [
    { id: "desk-01", x: 2, y: 2, label: "Desk 01" },
    { id: "desk-02", x: 5, y: 2, label: "Desk 02" },
    { id: "desk-03", x: 8, y: 2, label: "Desk 03" },
    { id: "desk-04", x: 11, y: 2, label: "Desk 04" },
    { id: "desk-05", x: 2, y: 5, label: "Desk 05" },
    { id: "desk-06", x: 5, y: 5, label: "Desk 06" },
    { id: "desk-07", x: 8, y: 5, label: "Desk 07" },
    { id: "desk-08", x: 11, y: 5, label: "Desk 08" },
    { id: "desk-09", x: 2, y: 8, label: "Desk 09" },
    { id: "desk-10", x: 5, y: 8, label: "Desk 10" },
    { id: "desk-11", x: 8, y: 8, label: "Desk 11" },
    { id: "desk-12", x: 11, y: 8, label: "Desk 12" },
  ],
};

export const assetLicense = "Project-owned minimalist pixel primitives released under MIT.";
