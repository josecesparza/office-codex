import { startDaemon } from "./app.js";

const daemon = await startDaemon();

const shutdown = async () => {
  await daemon.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
