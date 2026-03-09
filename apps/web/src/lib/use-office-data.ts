import { useCallback, useEffect, useState } from "react";

import type { AccountUsageStatus, AgentSession, OfficeLayout } from "@office-codex/core";

import {
  type EventEnvelope,
  type SessionCollectionMeta,
  daemonEventTypes,
  useOfficeStore,
} from "./office-store";

interface SessionCollectionPayload {
  meta: SessionCollectionMeta;
  sessions: AgentSession[];
}

interface LoadHistoryOptions {
  reset?: boolean;
}

interface UseOfficeDataResult {
  historyLoaded: boolean;
  historyLoading: boolean;
  loadMoreHistory(options?: LoadHistoryOptions): Promise<void>;
}

export function useOfficeData(): UseOfficeDataResult {
  const setAccount = useOfficeStore((state) => state.setAccount);
  const setConnection = useOfficeStore((state) => state.setConnection);
  const setHistoryPage = useOfficeStore((state) => state.setHistoryPage);
  const setLayout = useOfficeStore((state) => state.setLayout);
  const setLiveSnapshot = useOfficeStore((state) => state.setLiveSnapshot);
  const applyEnvelope = useOfficeStore((state) => state.applyEnvelope);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadMoreHistory = useCallback(
    async (options: LoadHistoryOptions = {}): Promise<void> => {
      const { historySessions } = useOfficeStore.getState();
      const query = new URLSearchParams({
        limit: "20",
        scope: "history",
      });

      if (!options.reset) {
        const before = historySessions.at(-1)?.updatedAt;

        if (before) {
          query.set("before", before);
        }
      }

      setHistoryLoading(true);

      try {
        const response = await fetch(`/api/sessions?${query.toString()}`);

        if (!response.ok) {
          throw new Error("Unable to load offline history");
        }

        const payload = (await response.json()) as SessionCollectionPayload;

        setHistoryPage(payload.sessions, payload.meta, options.reset ? "replace" : "append");
        setHistoryLoaded(true);
      } finally {
        setHistoryLoading(false);
      }
    },
    [setHistoryPage],
  );

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;

    async function bootstrap(): Promise<void> {
      try {
        const [layoutResponse, sessionsResponse, accountResponse] = await Promise.all([
          fetch("/api/layout"),
          fetch("/api/sessions?scope=live"),
          fetch("/api/account"),
        ]);

        if (!layoutResponse.ok || !sessionsResponse.ok) {
          throw new Error("Unable to bootstrap office data");
        }

        const layoutPayload = (await layoutResponse.json()) as { layout: OfficeLayout };
        const sessionsPayload = (await sessionsResponse.json()) as SessionCollectionPayload;
        const accountPayload = accountResponse.ok
          ? ((await accountResponse.json()) as { account: AccountUsageStatus })
          : null;

        if (!disposed) {
          if (accountPayload) {
            setAccount(accountPayload.account);
          }
          setLayout(layoutPayload.layout);
          setLiveSnapshot(sessionsPayload.sessions, sessionsPayload.meta);
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
      const payload = JSON.parse(event.data) as SessionCollectionPayload;

      if (!disposed) {
        setLiveSnapshot(
          payload.sessions.filter((session) => session.state !== "offline"),
          payload.meta,
        );
      }
    });

    source.addEventListener("account_updated", (event) => {
      const payload = JSON.parse(event.data) as { account: AccountUsageStatus };

      if (!disposed) {
        setAccount(payload.account);
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
  }, [applyEnvelope, setAccount, setConnection, setLayout, setLiveSnapshot]);

  return {
    historyLoaded,
    historyLoading,
    loadMoreHistory,
  };
}
