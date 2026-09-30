import { buildPairingUrl, DEFAULT_PORTS, resolveClusterConfig } from "@leash/contracts";
import { connectLeash, loadAgentKey, waitForPairing } from "@leash/tools/node";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnv } from "./env.ts";
import { createLeashMcpServer, type McpLog } from "./server.ts";

// The stdio entry point. stdout carries the MCP protocol, so every log line goes to stderr.

/** The web app that opens pairing links (02-contracts §11). */
const WEB_URL = `http://localhost:${DEFAULT_PORTS.web}`;
/** The name the owner sees in the pairing wizard. */
const PAIRING_LABEL = "Claude via MCP";

const log: McpLog = (message, details) => {
  const extra = details
    ? ` ${JSON.stringify(details, (_key, value) => (typeof value === "bigint" ? value.toString() : value))}`
    : "";
  process.stderr.write(`leash-mcp: ${message}${extra}\n`);
};

async function main(): Promise<void> {
  const env = loadEnv();
  const cluster = resolveClusterConfig(env.LEASH_CLUSTER, { rpcUrl: env.LEASH_RPC_URL });
  const key = await loadAgentKey(env.AGENT_KEYPAIR, { create: true });
  if (key.created) log(`created a new agent key at ${key.path}`);
  const link = buildPairingUrl(WEB_URL, {
    agentKey: key.signer.address,
    label: PAIRING_LABEL,
    preset: "custom",
    cluster: cluster.cluster,
  });
  const { agent, tools } = connectLeash({
    cluster,
    signer: key.signer,
    owner: env.AGENT_OWNER,
    priorityFeeMicroLamports: BigInt(env.LEASH_PRIORITY_FEE_MICROLAMPORTS),
    pairingLink: link,
    logger: { warn: log },
  });

  const server = createLeashMcpServer({ tools, log });
  const stop = new AbortController();
  // The client closed our stdin: stop polling so the process can exit.
  process.stdin.on("end", () => {
    stop.abort();
    void server.close();
  });
  await server.connect(new StdioServerTransport());
  log(`ready on ${cluster.cluster}: agent key ${agent.address}, owner ${env.AGENT_OWNER}`);

  let chainWarned = false;
  await waitForPairing({
    agent,
    link,
    signal: stop.signal,
    onUnpaired: (pairingLink) =>
      log(`not paired yet; payments answer NOT_PAIRED until the owner opens ${pairingLink}`),
    onPaired: () => log("paired: payments are active"),
    onError: (error) => {
      if (chainWarned) return;
      chainWarned = true;
      log("cannot read the chain yet; retrying", { error: String(error) });
    },
  });
}

main().catch((error: unknown) => {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
