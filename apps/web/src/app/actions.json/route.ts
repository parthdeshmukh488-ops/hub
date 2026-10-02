import { ACTIONS_JSON } from "@leash/contracts";
import { actionJson, actionOptions } from "../../server/actions/http.ts";

// `GET /actions.json` (02-contracts §10): tells Blink clients where the Actions live.
export function GET(): Response {
  return actionJson(ACTIONS_JSON);
}

export function OPTIONS(): Response {
  return actionOptions();
}
