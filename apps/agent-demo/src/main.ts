import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildPairingUrl,
  DEFAULT_PORTS,
  explorerTxUrl,
  resolveClusterConfig,
} from "@leash/contracts";
import { connectLeash, loadAgentKey, waitForPairing } from "@leash/tools/node";
import { ownerDecisions } from "./approvals.ts";
import { type Env, loadEnv } from "./env.ts";
import { createExecutor, toolDefinitions } from "./executor.ts";
import { runAgent } from "./loop.ts";
import { claudeModel, type Model } from "./model.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { type Recording, RecordingSchema, recordingModel, replayModel } from "./recording.ts";
import { parseScenes, SCENES, type SceneId } from "./scenes.ts";
import { createUi } from "./ui.ts";

// The demo agent (WS7 step 2): `pnpm demo [scene…] [--scripted] [--record]`.

const SCENES_DIR = fileURLToPath(new URL("../scenes/", import.meta.url));
const WEB_URL = `http://localhost:${DEFAULT_PORTS.web}`;
const LABEL = "Research Assistant";
const USAGE = `Usage: pnpm --filter @leash/agent-demo demo [normal|approval|injection|runaway|all …] [--scripted] [--record]

  --scripted  replay scenes/<scene>.json instead of asking Claude (no API key needed)
  --record    LLM mode: save each scene's model turns to scenes/<scene>.recorded.json`;

type Args = { scenes: SceneId[]; scripted: boolean; record: boolean };

function parseArgs(argv: readonly string[], env: Env): Args {
  const flags = argv.filter((arg) => arg.startsWith("-"));
  for (const flag of flags) {
    if (!["--scripted", "--record"].includes(flag))
      throw new Error(`Unknown option ${flag}.\n\n${USAGE}`);
  }
  const args = {
    scenes: parseScenes(argv.filter((arg) => !arg.startsWith("-"))),
    scripted: flags.includes("--scripted") || env.AGENT_MODE === "scripted",
    record: flags.includes("--record"),
  };
  if (args.scripted && args.record)
    throw new Error("--record records LLM runs; it does not combine with --scripted.");
  if (!args.scripted && !env.ANTHROPIC_API_KEY) {
    throw new Error(
      "LLM mode needs ANTHROPIC_API_KEY. Without one, run the scripted demo: --scripted",
    );
  }
  return args;
}

function loadRecording(scene: SceneId): Recording {
  const file = `${SCENES_DIR}${scene}.json`;
  if (!existsSync(file)) throw new Error(`No recording for "${scene}" at ${file}.`);
  return RecordingSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const env = loadEnv();
  const args = parseArgs(argv, env);
  const cluster = resolveClusterConfig(env.LEASH_CLUSTER, { rpcUrl: env.LEASH_RPC_URL });
  const ui = createUi({
    write: (line) => process.stdout.write(`${line}\n`),
    color: process.stdout.isTTY === true && process.stdout.hasColors(),
    explorer: (signature) => explorerTxUrl(cluster, signature),
  });

  const key = await loadAgentKey(env.AGENT_KEYPAIR, { create: true });
  if (key.created) ui.notice(`Created a new agent key at ${key.path}.`);
  const link = buildPairingUrl(WEB_URL, {
    agentKey: key.signer.address,
    label: LABEL,
    preset: "research-assistant",
    cluster: cluster.cluster,
  });
  const runtime = connectLeash({
    cluster,
    signer: key.signer,
    owner: env.AGENT_OWNER,
    priorityFeeMicroLamports: BigInt(env.LEASH_PRIORITY_FEE_MICROLAMPORTS),
    pairingLink: link,
    logger: { warn: (message) => ui.notice(message) },
  });
  let warned = false;
  await waitForPairing({
    agent: runtime.agent,
    link,
    onUnpaired: (pairingLink) =>
      ui.waiting(`Not paired yet. The owner pairs this agent at ${pairingLink}`),
    onPaired: () => ui.waiting("Paired."),
    onError: (error) => {
      if (!warned) ui.error(`Cannot read the chain yet (${String(error)}); retrying.`);
      warned = true;
    },
  });

  const claude = args.scripted
    ? null
    : claudeModel({
        messages: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }).messages,
        model: env.AGENT_MODEL,
        system: SYSTEM_PROMPT,
        tools: toolDefinitions(runtime.tools),
      });
  ui.header("Leash demo agent", [
    LABEL,
    cluster.cluster,
    claude ? claude.label : "scripted",
    `agent key ${runtime.agent.address}`,
  ]);

  const execute = createExecutor({ tools: runtime.tools, fetch: globalThis.fetch });
  const awaitOwner = ownerDecisions({
    chain: runtime.chain,
    agent: await runtime.agent.agentAddress(),
    ui,
  });
  for (const id of args.scenes) {
    const scene = SCENES[id];
    const task = scene.task(env.AGENT_MERCHANT_URL);
    let model: Model;
    let recorder: ReturnType<typeof recordingModel> | null = null;
    if (claude === null) {
      const recording = loadRecording(id);
      model = replayModel(recording);
      ui.scene(scene.title, task);
      ui.notice(recording.disclosure);
    } else {
      recorder = args.record ? recordingModel(claude) : null;
      model = recorder?.model ?? claude;
      ui.scene(scene.title, task);
    }
    const result = await runAgent({
      session: model.session(),
      task,
      execute,
      ui,
      maxTurns: scene.maxTurns,
      awaitOwner,
    });
    ui.summary(result);
    if (recorder) {
      const recording: Recording = {
        version: 1,
        scene: id,
        source: "llm",
        model: env.AGENT_MODEL,
        recordedAt: new Date().toISOString(),
        disclosure: `Replay of a recorded run of ${env.AGENT_MODEL}. The model's decisions are replayed; every tool runs live.`,
        turns: recorder.turns,
      };
      writeFileSync(`${SCENES_DIR}${id}.recorded.json`, `${JSON.stringify(recording, null, 2)}\n`);
      ui.notice(`Recorded to scenes/${id}.recorded.json.`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
