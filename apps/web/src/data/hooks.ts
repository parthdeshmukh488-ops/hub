"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { queryKeys } from "../live/apply.ts";
import type { ActivityFilter } from "../live/merge.ts";
import { getDataSource } from "./index.ts";
import { DEMO_OWNER } from "./owner.ts";

// Query hooks: the only way screens read data. The live stream keeps these caches current.

export function useOverview() {
  return useQuery({
    queryKey: queryKeys.overview(DEMO_OWNER),
    queryFn: () => getDataSource().overview(DEMO_OWNER),
  });
}

export function useAgentDetail(address: string) {
  return useQuery({
    queryKey: queryKeys.agent(DEMO_OWNER, address),
    queryFn: () => getDataSource().agent(DEMO_OWNER, address),
  });
}

export function useRequests() {
  return useQuery({
    queryKey: queryKeys.requests(DEMO_OWNER),
    queryFn: () => getDataSource().requests(DEMO_OWNER),
  });
}

export function useActivity(filter: ActivityFilter) {
  return useInfiniteQuery({
    queryKey: queryKeys.activityFor(DEMO_OWNER, filter),
    queryFn: ({ pageParam }) =>
      getDataSource().events(DEMO_OWNER, { ...filter, before: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
  });
}
