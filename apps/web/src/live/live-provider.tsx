"use client";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { getDataSource } from "../data/index.ts";
import { DEMO_OWNER } from "../data/owner.ts";
import { env } from "../env.ts";
import { applyMessage, reload, resync } from "./apply.ts";
import { type LiveStatus, LiveStream } from "./stream.ts";

type Live = { status: LiveStatus | "sample"; now: number };

const LiveContext = createContext<Live>({ status: "sample", now: 0 });

/** The stream's state and the clock relative times are measured against. */
export function useLive(): Live {
  return useContext(LiveContext);
}

/** Query cache plus, in indexer mode, the live stream that keeps it current. */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const fixtures = getDataSource().kind === "fixtures";
    return new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: fixtures ? Number.POSITIVE_INFINITY : 30_000,
          refetchOnWindowFocus: !fixtures,
          retry: 1,
        },
      },
    });
  });
  return (
    <QueryClientProvider client={client}>
      <LiveUpdates>{children}</LiveUpdates>
    </QueryClientProvider>
  );
}

function LiveUpdates({ children }: { children: ReactNode }) {
  const source = getDataSource();
  const client = useQueryClient();
  const [status, setStatus] = useState<Live["status"]>(
    source.kind === "fixtures" ? "sample" : "connecting",
  );
  const [now, setNow] = useState(() => source.now());

  useEffect(() => {
    if (source.kind !== "indexer") return;
    const tick = setInterval(() => setNow(source.now()), 15_000);
    const stream = new LiveStream({
      url: env.NEXT_PUBLIC_INDEXER_WS_URL,
      owner: DEMO_OWNER,
      source,
      onMessage: (message) => {
        applyMessage(client, DEMO_OWNER, message);
        if (message.type === "event") setNow(source.now());
      },
      onResync: () => resync(client, DEMO_OWNER),
      onReset: () => reload(client, DEMO_OWNER),
      onStatus: setStatus,
    });
    stream.start();
    return () => {
      clearInterval(tick);
      stream.stop();
    };
  }, [client, source]);

  return <LiveContext.Provider value={{ status, now }}>{children}</LiveContext.Provider>;
}
