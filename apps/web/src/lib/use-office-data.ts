import { useEffect } from "react";

import type { AccountUsageStatus, AgentSession, OfficeLayout } from "@office-codex/core";

import { type EventEnvelope, daemonEventTypes, useOfficeStore } from "./office-store";

export function useOfficeData(): void {
  const setAccount = useOfficeStore((state) => state.setAccount);
  const setConnection = useOfficeStore((state) => state.setConnection);
  const setLayout = useOfficeStore((state) => state.setLayout);
  const setSnapshot = useOfficeStore((state) => state.setSnapshot);
  const applyEnvelope = useOfficeStore((state) => state.applyEnvelope);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;

    async function bootstrap(): Promise<void> {
      try {
        const [layoutResponse, sessionsResponse] = await Promise.all([
          fetch("/api/layout"),
          fetch("/api/sessions"),
        ]);

        if (!layoutResponse.ok || !sessionsResponse.ok) {
          throw new Error("Unable to bootstrap office data");
        }

        const layoutPayload = (await layoutResponse.json()) as { layout: OfficeLayout };
        const sessionsPayload = (await sessionsResponse.json()) as { sessions: AgentSession[] };
        const accountPayload = (await fetch("/api/account").then((response) =>
          response.ok ? (response.json() as Promise<{ account: AccountUsageStatus }>) : null,
        )) as { account: AccountUsageStatus } | null;

        if (!disposed) {
          if (accountPayload) {
            setAccount(accountPayload.account);
          }
          setLayout(layoutPayload.layout);
          setSnapshot(sessionsPayload.sessions);
          setConnection("ready");
        }
      } catch {
        if (!disposed) {
          setConnection("error");
        }
      }
    }

    bootstrap().catch(() => {
      setConnection("error");
    });

    source = new EventSource("/api/events");
    source.onopen = () => {
      if (!disposed) {
        setConnection("ready");
      }
    };
    source.onerror = () => {
      if (!disposed) {
        setConnection("error");
      }
    };

    source.addEventListener("snapshot", (event) => {
      const payload = JSON.parse(event.data) as { sessions: AgentSession[] };

      if (!disposed) {
        setSnapshot(payload.sessions);
      }
    });

    for (const eventType of daemonEventTypes) {
      source.addEventListener(eventType, (event) => {
        const payload = JSON.parse(event.data) as EventEnvelope;

        if (!disposed) {
          applyEnvelope(payload);
        }
      });
    }

    return () => {
      disposed = true;
      source?.close();
    };
  }, [applyEnvelope, setAccount, setConnection, setLayout, setSnapshot]);
}
