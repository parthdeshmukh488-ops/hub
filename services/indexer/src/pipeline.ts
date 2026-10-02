import type { Logger } from "./logger.ts";
import type { EventSink } from "./sources/source.ts";
import type { Store } from "./store.ts";
import type { StreamHub } from "./stream.ts";

/**
 * Connects a source to the store and the stream: every delivery is stored first, then new events
 * and the agents they changed are published, per owner and in order. Deliveries are queued, so
 * two sources (or a reconciliation) can never interleave writes.
 */
export function createPipeline(
  store: Store,
  hub: StreamHub | null,
  now: () => number,
  log: Logger,
): EventSink {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  };

  async function publishAgents(agents: readonly string[]): Promise<void> {
    if (!hub) return;
    for (const address of agents) {
      const agent = await store.agentView(address, now());
      if (agent) hub.publish(agent.owner, { type: "agent", agent });
    }
  }

  return {
    accounts: (facts) =>
      serial(async () => {
        await publishAgents(await store.applyAccounts(facts));
      }),
    events: (events) =>
      serial(async () => {
        const { inserted, changedAgents } = await store.ingest(events);
        for (const { event, owner } of inserted) {
          if (owner) hub?.publish(owner, { type: "event", event });
        }
        await publishAgents(changedAgents);
        if (inserted.length > 0) log.debug({ events: inserted.length }, "ingested");
      }),
    resetProjections: () => serial(() => store.resetProjections()),
    snapshot: (snapshot) =>
      serial(async () => {
        await publishAgents(await store.applySnapshot(snapshot));
      }),
  };
}
