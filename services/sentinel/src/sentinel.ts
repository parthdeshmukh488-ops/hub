import type { Alert, LeashEvent } from "@leash/contracts";
import type { SentinelConfig } from "./config.ts";
import { type IndexerClient, IndexerError } from "./indexer-client.ts";
import type { Logger } from "./logger.ts";
import type { Notifier } from "./notifiers/notifier.ts";
import { evaluate } from "./rules/evaluate.ts";
import { emptyOwnerState, type OwnerState } from "./rules/state.ts";
import type { RuleInput, SentinelAction } from "./rules/types.ts";
import { StreamClient, type StreamClientOptions, type StreamData } from "./stream-client.ts";

// Sentinel's loop: find the owners whose guardian it is, warm the rules up on their recent
// history (silently), then follow the indexer's stream and fill every gap with `?after=`.
// Everything runs through one serial queue, so inputs reach the rules in the order they came.

export interface SentinelOptions {
  indexer: IndexerClient;
  /** Whose principals to watch (`--guardian` or the guardian keypair's address). */
  guardian: string;
  notifiers: Notifier[];
  config: SentinelConfig;
  webUrl: string;
  log: Logger;
  /** Unix seconds; stamps `createdAt`. Rules themselves run on event time. */
  clock?: () => number;
  /**
   * Receives the freezes the rules ask for, with the alerts that asked; returns the alerts to
   * send about what it did (`guardian_freeze`). The guardian (`guardian.ts`) decides.
   */
  onActions?: (actions: SentinelAction[], alerts: Alert[]) => Promise<Alert[]>;
  /** How often to look for principals that newly named this guardian. */
  refreshOwnersMs?: number;
  stream?: StreamClientOptions;
}

export interface SentinelStatus {
  ok: boolean;
  connected: boolean;
  guardian: string;
  owners: string[];
  /** Wall-clock time of the last event handled. */
  lastEventAt: number | null;
  alertsSent: number;
  alertsFailed: number;
}

interface Watched {
  state: OwnerState;
  /** Warmed up and subscribed: live messages and backfills apply. */
  ready: boolean;
  /** The newest event handled: the `?after=` cursor. */
  lastSeenId: string | null;
}

/** History read silently at start, so windows, labels and dedupe know the recent past. */
const WARM_UP_EVENTS = 200;
const PAGE_LIMIT = 200;

export class Sentinel {
  private readonly owners = new Map<string, Watched>();
  private readonly principalOwner = new Map<string, string>();
  private readonly agentOwner = new Map<string, string>();
  private readonly stream: StreamClient;
  private readonly clock: () => number;
  private queue: Promise<void> = Promise.resolve();
  private refreshTimer: NodeJS.Timeout | null = null;
  private ownersLoaded = false;
  private lastEventAt: number | null = null;
  private alertsSent = 0;
  private alertsFailed = 0;

  constructor(private readonly options: SentinelOptions) {
    this.clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
    this.stream = new StreamClient(
      options.indexer.streamUrl,
      () => this.readyOwners(),
      {
        // Queued before the subscription goes out, so live messages wait behind the backfill.
        onOpen: () => {
          for (const owner of this.readyOwners()) this.enqueue(() => this.backfill(owner));
        },
        onData: (message) => this.enqueue(() => this.receive(message)),
      },
      options.log,
      options.stream,
    );
  }

  async start(): Promise<void> {
    await this.refreshOwners();
    this.stream.start();
    this.refreshTimer = setInterval(
      () => void this.refreshOwners(),
      this.options.refreshOwnersMs ?? 30_000,
    );
    this.refreshTimer.unref();
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.stream.stop();
    await this.idle();
  }

  /** Resolves once everything queued so far has been handled. */
  async idle(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.queue;
      await current;
    } while (current !== this.queue);
  }

  status(): SentinelStatus {
    const connected = this.stream.connected;
    return {
      ok: connected && this.ownersLoaded,
      connected,
      guardian: this.options.guardian,
      owners: [...this.owners.keys()],
      lastEventAt: this.lastEventAt,
      alertsSent: this.alertsSent,
      alertsFailed: this.alertsFailed,
    };
  }

  private readyOwners(): string[] {
    return [...this.owners].filter(([, watched]) => watched.ready).map(([owner]) => owner);
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((error: unknown) => {
      this.options.log.error({ err: errorMessage(error) }, "sentinel task failed");
    });
  }

  private async refreshOwners(): Promise<void> {
    let owners: string[];
    try {
      owners = await this.options.indexer.guardianOwners(this.options.guardian);
    } catch (error) {
      this.options.log.warn({ err: errorMessage(error) }, "cannot list the guardian's owners yet");
      return;
    }
    const first = !this.ownersLoaded;
    if (first) {
      this.ownersLoaded = true;
      this.options.log.info({ guardian: this.options.guardian, owners }, "watching owners");
      if (owners.length === 0) {
        this.options.log.warn(
          { guardian: this.options.guardian },
          "no principal names this guardian yet; checking again periodically",
        );
      }
    }
    const added = owners.filter((owner) => !this.owners.has(owner));
    if (added.length > 0 && !first) this.options.log.info({ owners: added }, "new owners to watch");
    for (const owner of added) {
      const watched: Watched = { state: emptyOwnerState(owner), ready: false, lastSeenId: null };
      this.owners.set(owner, watched);
      this.enqueue(() => this.watch(owner, watched));
    }
  }

  /**
   * Warm-up first, then the subscription, then a backfill from the warm-up's cursor. What the
   * warm-up read is the past (silent); anything after it alerts, whether it comes from the
   * backfill or the stream (whose messages queue behind this task; duplicates are dropped).
   */
  private async watch(owner: string, watched: Watched): Promise<void> {
    try {
      await this.warmUp(owner);
    } catch (error) {
      // Forget the owner, so the next refresh tries again from scratch.
      this.owners.delete(owner);
      throw error;
    }
    watched.ready = true;
    this.stream.subscribe([owner]);
    await this.backfill(owner);
  }

  /** Views, allowlists and recent history: the rules learn them without alerting on the past. */
  private async warmUp(owner: string): Promise<void> {
    const { indexer } = this.options;
    const overview = await indexer.owner(owner);
    if (overview.principal) this.principalOwner.set(overview.principal.address, owner);
    for (const view of overview.agents) {
      this.agentOwner.set(view.address, owner);
      const detail = await indexer.agent(view.address);
      await this.handle(owner, { kind: "payees", agent: view.address, payees: detail.payees });
    }
    const page = await indexer.ownerEvents(owner, { limit: WARM_UP_EVENTS });
    for (const event of [...page.items].reverse()) {
      await this.handle(owner, { kind: "event", event }, { silent: true });
    }
    // Agent views last: they are the current state, and a low allowance now is worth an alert.
    for (const view of overview.agents) await this.handle(owner, { kind: "agent", agent: view });
    this.options.log.info(
      { owner, agents: overview.agents.length, history: page.items.length },
      "owner warmed up",
    );
  }

  /** Every event after the cursor, oldest first, with alerts: they happened while we were away. */
  private async backfill(owner: string): Promise<void> {
    const watched = this.owners.get(owner);
    if (!watched) return;
    if (watched.lastSeenId === null) {
      // No history at warm-up: whatever exists now is new.
      const page = await this.options.indexer.ownerEvents(owner, { limit: PAGE_LIMIT });
      for (const event of [...page.items].reverse())
        await this.handle(owner, { kind: "event", event });
      return;
    }
    for (;;) {
      const after: string = watched.lastSeenId ?? "";
      let items: LeashEvent[];
      try {
        items = (await this.options.indexer.ownerEvents(owner, { after, limit: PAGE_LIMIT })).items;
      } catch (error) {
        if (error instanceof IndexerError && error.status === 404) {
          // The indexer no longer knows our cursor (its database was reset): start over quietly.
          this.options.log.warn({ owner }, "indexer forgot our cursor; warming up again");
          watched.lastSeenId = null;
          await this.warmUp(owner);
          return;
        }
        throw error;
      }
      for (const event of items) await this.handle(owner, { kind: "event", event });
      if (items.length < PAGE_LIMIT) return;
    }
  }

  private async receive(message: StreamData): Promise<void> {
    if (message.type === "agent") {
      const owner = message.agent.owner;
      if (!this.owners.has(owner)) return;
      this.agentOwner.set(message.agent.address, owner);
      await this.handle(owner, { kind: "agent", agent: message.agent });
      return;
    }
    const event = message.event;
    const owner = this.ownerOf(event);
    if (!owner) {
      this.options.log.debug({ event: event.id }, "event for an owner we do not watch");
      return;
    }
    await this.handle(owner, { kind: "event", event });
  }

  private ownerOf(event: LeashEvent): string | null {
    if (event.type === "PrincipalInitialized" && this.owners.has(event.owner)) {
      if (event.principal) this.principalOwner.set(event.principal, event.owner);
      return event.owner;
    }
    const byPrincipal = event.principal ? this.principalOwner.get(event.principal) : undefined;
    if (byPrincipal) {
      if (event.agent) this.agentOwner.set(event.agent, byPrincipal);
      return byPrincipal;
    }
    return (event.agent && this.agentOwner.get(event.agent)) || null;
  }

  private async handle(
    owner: string,
    input: RuleInput,
    { silent = false }: { silent?: boolean } = {},
  ): Promise<void> {
    const watched = this.owners.get(owner);
    if (!watched) return;
    if (input.kind === "event") {
      const event = input.event;
      if (event.principal) this.principalOwner.set(event.principal, owner);
      if (event.agent) this.agentOwner.set(event.agent, owner);
    }
    const result = evaluate(watched.state, input, this.clock(), {
      config: this.options.config,
      webUrl: this.options.webUrl,
    });
    watched.state = result.state;
    if (input.kind === "event") {
      watched.lastSeenId = input.event.id;
      if (!silent) this.lastEventAt = this.clock();
    }
    if (silent) return;
    await this.deliver(owner, result.alerts);
    if (result.actions.length > 0) {
      if (this.options.onActions) {
        await this.deliver(owner, await this.options.onActions(result.actions, result.alerts));
      } else {
        this.options.log.info({ owner, actions: result.actions }, "freeze asked for; no guardian");
      }
    }
  }

  private async deliver(owner: string, alerts: readonly Alert[]): Promise<void> {
    for (const alert of alerts) {
      this.options.log.info(
        { owner, agent: alert.agent, alert: alert.id, kind: alert.kind },
        "alert",
      );
      for (const notifier of this.options.notifiers) {
        try {
          await notifier.send(alert);
          this.alertsSent++;
        } catch (error) {
          this.alertsFailed++;
          this.options.log.error(
            { notifier: notifier.name, alert: alert.id, err: errorMessage(error) },
            "alert not delivered",
          );
        }
      }
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
