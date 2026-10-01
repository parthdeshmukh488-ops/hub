import { productionDeps } from "../../../../server/actions/deps.ts";
import { freezeAllAction } from "../../../../server/actions/freeze-all.ts";
import { actionHandlers } from "../../../../server/actions/route-handlers.ts";

// Solana Action (02-contracts §10). The logic and its tests live in src/server/actions/.
const handlers = actionHandlers(freezeAllAction, productionDeps);

export const GET = handlers.GET;
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
