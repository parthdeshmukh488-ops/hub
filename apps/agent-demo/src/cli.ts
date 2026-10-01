import type { Env } from "./env.ts";
import { parseScenes, type SceneId } from "./scenes.ts";

export const USAGE = `Usage: pnpm --filter @leash/agent-demo demo [normal|approval|injection|runaway|all …] [--scripted] [--record]

  --scripted  replay scenes/<scene>.json instead of asking Claude (no API key needed)
  --record    LLM mode: save each scene's model turns to scenes/<scene>.recorded.json`;

export type Args = { scenes: SceneId[]; scripted: boolean; record: boolean };

/** The command line, checked against the configuration. Throws a readable error. */
export function parseArgs(
  argv: readonly string[],
  env: Pick<Env, "AGENT_MODE" | "ANTHROPIC_API_KEY">,
): Args {
  // `pnpm demo:all -- --scripted` passes the `--` through.
  const words = argv.filter((arg) => arg !== "--");
  const flags = words.filter((arg) => arg.startsWith("-"));
  for (const flag of flags) {
    if (flag !== "--scripted" && flag !== "--record") {
      throw new Error(`Unknown option ${flag}.\n\n${USAGE}`);
    }
  }
  const args = {
    scenes: parseScenes(words.filter((arg) => !arg.startsWith("-"))),
    scripted: flags.includes("--scripted") || env.AGENT_MODE === "scripted",
    record: flags.includes("--record"),
  };
  if (args.scripted && args.record) {
    throw new Error("--record records LLM runs; it does not combine with --scripted.");
  }
  if (!args.scripted && !env.ANTHROPIC_API_KEY) {
    throw new Error(
      "LLM mode needs ANTHROPIC_API_KEY. Without one, run the scripted demo: --scripted",
    );
  }
  return args;
}
