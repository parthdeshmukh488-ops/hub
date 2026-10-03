import { runDemo } from "@leash/agent-demo/demo";
import type { SceneId } from "@leash/agent-demo/scenes";
import { createUi, type Ui } from "@leash/agent-demo/ui";
import { type Alert, CAIP2, type RequestView, resolveClusterConfig } from "@leash/contracts";
import { startTestIndexer, type TestIndexer } from "@leash/indexer/testing";
import { loadContent } from "@leash/merchant-demo/content";
import { createApp } from "@leash/merchant-demo/server";
import { buildApproveRequest, fetchOpenRequests, LEASH_PROGRAM_ADDRESS } from "@leash/sdk";
import { createTestbed, type Testbed } from "@leash/sdk/testing";
import { createIndexerClient, DEFAULT_CONFIG, Sentinel } from "@leash/sentinel";
import { connectLeash } from "@leash/tools/node";
import { litesvmFacilitatorClient } from "@leash/x402/testing";
import { address } from "@solana/kit";
import { pino } from "pino";

// The whole system in process on LiteSVM, with no network, shared by the storyline test and
// `pnpm demo`:
//   the demo agent (scripted scenes) → its tools → merchant-demo with x402 payments on → the
//   official facilitator → the Leash program and Subscriptions (the real binaries) → the indexer
//   in chain mode over the same chain → Sentinel, live on the indexer's stream.

export const MERCHANT_URL = "http://merchant.test";
export const WEB_URL = "http://localhost:3000";

export type StackOptions = {
  /** The demo screen's output. */
  write(line: string): void;
  /** Colours and clickable links on the demo screen. */
  color: boolean;
  /** Every alert Sentinel sends. */
  onAlert(alert: Alert): void;
};

export type Stack = Awaited<ReturnType<typeof startStack>>;

export async function waitFor(
  check: () => boolean,
  what: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export async function startStack(options: StackOptions) {
  const bed: Testbed = await createTestbed();

  // merchant-demo (lab included) with x402 payments through the official facilitator. Its
  // settlements go through the testbed chain, so its history and the indexer see them.
  const app = createApp(
    {
      wallets: { merchant: bed.keys.merchant.address, attacker: bed.keys.attacker.address },
      payments: "on",
      x402: {
        facilitator: litesvmFacilitatorClient(bed.svm, [bed.keys.stranger], CAIP2.localnet, {
          chain: bed.chain,
        }),
        network: CAIP2.localnet,
        asset: bed.mint,
      },
    },
    loadContent(),
  );
  const merchantFetch = async (input: string | URL | Request, init?: RequestInit) =>
    app.fetch(new Request(input, init));

  // The agent's real tools and the demo's screen.
  const cluster = resolveClusterConfig("localnet", { usdcMint: bed.mint });
  const runtime = connectLeash({
    cluster,
    signer: bed.keys.agentKey,
    owner: bed.keys.owner.address,
    chain: bed.chain,
    fetch: merchantFetch,
    logger: { warn: () => {} },
  });
  const ui: Ui = createUi({
    write: options.write,
    color: options.color,
    // No explorer can open a transaction of this in-process chain.
    explorer: () => null,
  });

  // The indexer follows the same chain, read only when `sync` says so.
  const indexer: TestIndexer = await startTestIndexer({
    source: { kind: "chain", chain: bed.chain, programId: LEASH_PROGRAM_ADDRESS },
    now: () => Number(bed.now()),
  });

  // Sentinel watches the principals whose guardian is the testbed's guardian key.
  const sentinel = new Sentinel({
    indexer: createIndexerClient(indexer.url),
    guardian: bed.keys.guardian.address,
    notifiers: [{ name: "collect", send: async (alert) => options.onAlert(alert) }],
    config: DEFAULT_CONFIG,
    webUrl: WEB_URL,
    log: pino({ level: "silent" }),
    clock: () => Number(bed.now()),
    refreshOwnersMs: 60_000,
  });
  await sentinel.start();
  await waitFor(() => sentinel.status().ok, "Sentinel connected with its owner");
  await sentinel.idle();

  /** The indexer reads the chain's new transactions; Sentinel gets them on the stream. */
  async function sync(): Promise<void> {
    await indexer.sync();
    // Let the stream's messages reach Sentinel's queue, then let it finish them.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await sentinel.idle();
  }

  /** The owner approves the agent's open request on-chain, as the web app's inbox would. */
  async function approveOpenRequest(): Promise<RequestView> {
    const [request] = await fetchOpenRequests(bed.chain, bed.accounts.agent);
    if (!request) throw new Error("no open request");
    await bed.send(bed.keys.owner, [
      await buildApproveRequest({
        owner: bed.keys.owner,
        agent: bed.accounts.agent,
        request: address(request.address),
      }),
    ]);
    return request;
  }

  /** One scene from its script; `ownerActs` runs once while the agent waits for the owner. */
  async function play(scene: SceneId, ownerActs?: () => Promise<void>) {
    let acted = false;
    const [result] = await runDemo({
      tools: runtime.tools,
      chain: bed.chain,
      agent: bed.accounts.agent,
      ui,
      scenes: [scene],
      merchant: MERCHANT_URL,
      fetch: merchantFetch,
      model: null,
      ownerWait: {
        pollMs: 1,
        sleep: async () => {
          if (acted || !ownerActs) return;
          acted = true;
          await ownerActs();
        },
      },
    });
    await sync();
    if (!result) throw new Error(`scene ${scene} did not run`);
    return result;
  }

  async function close(): Promise<void> {
    await sentinel.stop();
    await indexer.close();
  }

  return { bed, cluster, runtime, ui, indexer, sentinel, sync, approveOpenRequest, play, close };
}
