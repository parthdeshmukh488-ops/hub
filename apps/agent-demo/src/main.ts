import Anthropic from "@anthropic-ai/sdk";
import {
  buildPairingUrl,
  DEFAULT_PORTS,
  explorerTxUrl,
  resolveClusterConfig,
} from "@leash/contracts";
import { connectLeash, loadAgentKey, waitForPairing } from "@leash/tools/node";
import { parseArgs, USAGE } from "./cli.ts";
import { runDemo, SCENES_DIR } from "./demo.ts";
import { loadEnv } from "./env.ts";
import { toolDefinitions } from "./executor.ts";
import { claudeModel } from "./model.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { createUi } from "./ui.ts";

// The demo agent (WS7): `pnpm --filter agent-demo demo [scene…] [--scripted] [--record]`. Wires
// the configured cluster, the agent key and Claude around `runDemo`.

const WEB_URL = `http://localhost:${DEFAULT_PORTS.web}`;
const LABEL = "Research Assistant";

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
  ui.agentStatus(await runtime.tools.status());

  await runDemo({
    tools: runtime.tools,
    chain: runtime.chain,
    agent: await runtime.agent.agentAddress(),
    ui,
    scenes: args.scenes,
    merchant: env.AGENT_MERCHANT_URL,
    fetch: globalThis.fetch,
    model: claude,
    record: args.record ? { dir: SCENES_DIR, model: env.AGENT_MODEL } : undefined,
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
