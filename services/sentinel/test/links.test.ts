import { ACTION_ROUTES, ActionQuerySchemas } from "@leash/contracts";
import { describe, expect, it } from "vitest";
import { actionUrl, agentPageUrl, approvalsPageUrl } from "../src/links.ts";
import { key, OWNER, RESEARCH } from "./helpers.ts";

const WEB = "https://leash.example";

describe("Solana Action links (02 §10)", () => {
  const cases = [
    ["freeze", { agent: RESEARCH }],
    ["freezeAll", { owner: OWNER }],
    ["approve", { request: key("researchRequest0") }],
    ["reject", { request: key("researchRequest0") }],
  ] as const;

  it.each(cases)("builds the %s route with its query", (action, params) => {
    const url = new URL(actionUrl(WEB, action, params));
    expect(url.origin).toBe(WEB);
    expect(url.pathname).toBe(ACTION_ROUTES[action]);
    expect(ActionQuerySchemas[action].parse(Object.fromEntries(url.searchParams))).toEqual(params);
  });

  it("matches the routes of the contract exactly", () => {
    expect(actionUrl(WEB, "freezeAll", { owner: OWNER })).toBe(
      `${WEB}/api/actions/freeze-all?owner=${OWNER}`,
    );
  });

  it("refuses a parameter the route would reject", () => {
    expect(() => actionUrl(WEB, "freeze", { agent: "not an address" })).toThrow();
  });
});

describe("web app links", () => {
  it("joins the web URL without doubling slashes", () => {
    expect(agentPageUrl(`${WEB}/`, RESEARCH)).toBe(`${WEB}/app/agents/${RESEARCH}`);
    expect(approvalsPageUrl(`${WEB}/leash//`)).toBe(`${WEB}/leash/app/approvals`);
  });
});
