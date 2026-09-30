import { env } from "../env.ts";
import { createFixtureSource } from "./fixtures.ts";
import { createIndexerSource } from "./indexer.ts";
import type { LeashDataSource } from "./source.ts";

let source: LeashDataSource | undefined;

/** The configured data source (`NEXT_PUBLIC_DATA_SOURCE`). */
export function getDataSource(): LeashDataSource {
  source ??=
    env.NEXT_PUBLIC_DATA_SOURCE === "indexer"
      ? createIndexerSource(env.NEXT_PUBLIC_INDEXER_URL)
      : createFixtureSource();
  return source;
}

export type { AgentDetail, EventsFilter, EventsPage, LeashDataSource, Overview } from "./source.ts";
