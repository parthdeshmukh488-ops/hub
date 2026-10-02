import { productionDeps } from "../../../../server/actions/deps.ts";
import { freezeAction } from "../../../../server/actions/freeze.ts";
import { actionHandlers } from "../../../../server/actions/route-handlers.ts";

// Solana Action (02-contracts §10). The logic and its tests live in src/server/actions/.
const handlers = actionHandlers(freezeAction, productionDeps);

export const GET = handlers.GET;
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
