import { TOOL_NAMES } from "@leash/contracts";
import type { LeashTools } from "@leash/tools";
import { BROWSE_TOOL, browse } from "./browse.ts";
import type { Executor } from "./loop.ts";

const LEASH_TOOLS: ReadonlySet<string> = new Set(Object.values(TOOL_NAMES));

/** The demo agent's tools: the four Leash tools plus `browse`. */
export function createExecutor(options: {
  tools: LeashTools;
  fetch: typeof globalThis.fetch;
}): Executor {
  return async (name, input) => {
    if (name === BROWSE_TOOL.name) {
      const output = await browse(input, options.fetch);
      return { output, isError: !output.ok };
    }
    if (LEASH_TOOLS.has(name)) {
      const output = await options.tools.execute(name, input);
      return { output, isError: !output.ok };
    }
    return { output: { ok: false, error: `Unknown tool: ${name}` }, isError: true };
  };
}

/** The definitions the model sees, in one list. */
export const toolDefinitions = (tools: LeashTools) => [...tools.definitions, BROWSE_TOOL];
