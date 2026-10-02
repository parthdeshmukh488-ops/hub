"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { queryKeys } from "../live/apply.ts";
import type { ActivityFilter } from "../live/merge.ts";
import { getDataSource } from "./index.ts";
import { useViewerOwner } from "./viewer.ts";

// Query hooks: the only way screens read data. The live stream keeps these caches current.

export function useOverview() {
  const owner = useViewerOwner();
  return useQuery({
    queryKey: queryKeys.overview(owner),
    queryFn: () => getDataSource().overview(owner),
  });
}

export function useAgentDetail(address: string) {
  const owner = useViewerOwner();
  return useQuery({
    queryKey: queryKeys.agent(owner, address),
    queryFn: () => getDataSource().agent(owner, address),
  });
}

export function useRequests() {
  const owner = useViewerOwner();
  return useQuery({
    queryKey: queryKeys.requests(owner),
    queryFn: () => getDataSource().requests(owner),
  });
}

export function useActivity(filter: ActivityFilter) {
  const owner = useViewerOwner();
  return useInfiniteQuery({
    queryKey: queryKeys.activityFor(owner, filter),
    queryFn: ({ pageParam }) =>
      getDataSource().events(owner, { ...filter, before: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
  });
}
