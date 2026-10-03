import { readFileSync } from "node:fs";
import { CAIP2, explorerTxUrl, resolveClusterConfig } from "@leash/contracts";
import { loadContent } from "@leash/merchant-demo/content";
import { createApp } from "@leash/merchant-demo/server";
import { buildApproveRequest, buildRejectRequest, fetchOpenRequests } from "@leash/sdk";
import { createTestbed } from "@leash/sdk/testing";
import { connectLeash } from "@leash/tools/node";
import { litesvmFacilitatorClient } from "@leash/x402/testing";
import { address } from "@solana/kit";
import { ownerDecisions } from "../src/approvals.ts";
import { createExecutor } from "../src/executor.ts";
import { type RunResult, runAgent } from "../src/loop.ts";
import type { Model } from "../src/model.ts";
import { type Recording, RecordingSchema, replayModel } from "../src/recording.ts";
import { SCENES, type SceneId } from "../src/scenes.ts";
import { createUi } from "../src/ui.ts";

export const MERCHANT = "http://merchant.test";

export function loadScene(scene: SceneId): Recording {
  return RecordingSchema.parse(
    JSON.parse(readFileSync(new URL(`../scenes/${scene}.json`, import.meta.url), "utf8")),
  );
}

/**
 * The whole demo in process: merchant-demo (WS8, lab included) with payments on, the official x402
 * facilitator, and the agent's real tools, on the real program in LiteSVM. The screen is captured.
 */
export async function demoBed(
  options: {
    /** Answers a merchant request instead of merchant-demo, or null to let it through. */
    intercept?: (request: Request) => Response | null;
  } = {},
) {
  const bed = await createTestbed();
  const content = loadContent();
  const app = createApp(
    {
      wallets: { merchant: bed.keys.merchant.address, attacker: bed.keys.attacker.address },
      payments: "on",
      x402: {
        facilitator: litesvmFacilitatorClient(bed.svm, [bed.keys.stranger], CAIP2.localnet),
        network: CAIP2.localnet,
        asset: bed.mint,
      },
    },
    content,
  );
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    return options.intercept?.(request) ?? app.fetch(request);
  };
  const cluster = resolveClusterConfig("localnet", { usdcMint: bed.mint });
  const runtime = connectLeash({
    cluster,
    signer: bed.keys.agentKey,
    owner: bed.keys.owner.address,
    chain: bed.chain,
    fetch,
    logger: { warn: () => {} },
  });
  const lines: string[] = [];
  const ui = createUi({
    write: (line) => lines.push(line),
    color: false,
    explorer: (signature) => explorerTxUrl(cluster, signature),
  });
  const execute = createExecutor({ tools: runtime.tools, fetch });

  /** The owner's side, as the web app or Telegram would do it. */
  const owner = {
    async pending() {
      return (await fetchOpenRequests(bed.chain, bed.accounts.agent)).filter(
        (request) => request.status === "pending",
      );
    },
    async approveAll() {
      for (const request of await owner.pending()) {
        await bed.send(bed.keys.owner, [
          await buildApproveRequest({
            owner: bed.keys.owner,
            agent: bed.accounts.agent,
            request: address(request.address),
          }),
        ]);
      }
    },
    async rejectAll() {
      for (const request of await owner.pending()) {
        await bed.send(bed.keys.owner, [
          await buildRejectRequest({
            authority: bed.keys.owner,
            owner: bed.keys.owner.address,
            agent: bed.accounts.agent,
            request: address(request.address),
            rentReceiver: address(request.rentPayer),
          }),
        ]);
      }
    },
  };

  /** Runs a scene with a model; `ownerActs` runs while the loop waits for the owner. */
  async function play(
    scene: SceneId,
    model: Model,
    options: { ownerActs?: () => Promise<void>; timeoutMs?: number } = {},
  ): Promise<RunResult> {
    let acted = false;
    ui.scene(SCENES[scene].title, SCENES[scene].task(MERCHANT));
    const result = await runAgent({
      session: model.session(),
      task: SCENES[scene].task(MERCHANT),
      execute,
      ui,
      maxTurns: SCENES[scene].maxTurns,
      awaitOwner: ownerDecisions({
        chain: bed.chain,
        agent: bed.accounts.agent,
        ui,
        pollMs: 1,
        timeoutMs: options.timeoutMs ?? 60_000,
        sleep: async () => {
          if (!acted && options.ownerActs) {
            acted = true;
            await options.ownerActs();
          } else await new Promise((resolve) => setTimeout(resolve, 5));
        },
      }),
    });
    ui.summary(result);
    return result;
  }

  const replay = (scene: SceneId) => replayModel(loadScene(scene), { merchant: MERCHANT });
  return {
    bed,
    app,
    fetch,
    runtime,
    ui,
    lines,
    execute,
    owner,
    play,
    replay,
    screen: () => lines.join("\n"),
  };
}
