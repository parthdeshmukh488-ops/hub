import {
  ACTIONS_BLOCKCHAIN_ID,
  ACTIONS_CORS_HEADERS,
  ACTIONS_JSON,
  ActionErrorSchema,
  ActionGetResponseSchema,
  ActionPostResponseSchema,
} from "@leash/contracts";
import { buildFreezeAgent, fetchAgentView, fetchPrincipalView } from "@leash/sdk";
import { createTestbed, type Testbed } from "@leash/sdk/testing";
import {
  getBase64Encoder,
  getTransactionDecoder,
  type KeyPairSigner,
  signTransaction,
  type Transaction,
} from "@solana/kit";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GET as actionsJsonGet,
  OPTIONS as actionsJsonOptions,
} from "../src/app/actions.json/route.ts";
import { GET as iconGet } from "../src/app/api/actions/icon/route.ts";
import { freezeAction } from "../src/server/actions/freeze.ts";
import { freezeAllAction } from "../src/server/actions/freeze-all.ts";
import { ACTION_VERSION } from "../src/server/actions/http.ts";
import {
  type ActionDefinition,
  type ActionName,
  actionHandlers,
} from "../src/server/actions/route-handlers.ts";

// The Solana Actions of 02-contracts §10, on the LiteSVM testbed (the real leash.so): what a
// Blink client gets, and whether the transaction it signs does what it says on-chain.

const APP = "https://leash.example";

let bed: Testbed;
beforeEach(async () => {
  bed = await createTestbed();
});

function handlers<A extends ActionName>(definition: ActionDefinition<A>) {
  return actionHandlers(definition, () => ({ chain: bed.chain, appUrl: APP }));
}

const url = (path: string, query: Record<string, string>) =>
  `${APP}${path}?${new URLSearchParams(query).toString()}`;

const getAction = (
  h: ReturnType<typeof handlers>,
  path: string,
  query: Record<string, string>,
  accept = "application/json",
) => h.GET(new Request(url(path, query), { headers: { accept } }));

const postAction = (
  h: ReturnType<typeof handlers>,
  path: string,
  query: Record<string, string>,
  body: unknown,
) =>
  h.POST(
    new Request(url(path, query), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

function expectActionHeaders(response: Response) {
  for (const [name, value] of Object.entries(ACTIONS_CORS_HEADERS)) {
    expect(response.headers.get(name), name).toBe(value);
  }
  expect(response.headers.get("X-Action-Version")).toBe(ACTION_VERSION);
  expect(response.headers.get("X-Blockchain-Ids")).toBe(ACTIONS_BLOCKCHAIN_ID);
}

/** The POST answer's transaction: unsigned, as the server never signs (I6). */
async function transactionOf(response: Response): Promise<Transaction> {
  expect(response.status).toBe(200);
  const body = ActionPostResponseSchema.parse(await response.json());
  const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(body.transaction));
  expect(Object.values(transaction.signatures).every((s) => s === null)).toBe(true);
  return transaction;
}

/** What the wallet does: sign and send. */
async function signAndSend(transaction: Transaction, signer: KeyPairSigner) {
  const signed = await signTransaction([signer.keyPair], transaction);
  return bed.chain.sendAndConfirm(signed);
}

async function errorOf(response: Response, status: number) {
  expect(response.status).toBe(status);
  expectActionHeaders(response);
  return ActionErrorSchema.parse(await response.json()).message;
}

describe("actions.json and the icon", () => {
  it("serves ACTIONS_JSON with the Action headers", async () => {
    const response = actionsJsonGet();
    expectActionHeaders(response);
    expect(await response.json()).toEqual(ACTIONS_JSON);
    expectActionHeaders(actionsJsonOptions());
  });

  it("serves the purple L as SVG", async () => {
    const response = iconGet();
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(await response.text()).toContain("#6d28d9");
  });
});

describe("freeze?agent=", () => {
  const PATH = "/api/actions/freeze";
  const h = () => handlers(freezeAction);
  const query = () => ({ agent: bed.accounts.agent });

  it("describes the agent from the chain", async () => {
    const response = await getAction(h(), PATH, query());
    expectActionHeaders(response);
    const body = ActionGetResponseSchema.parse(await response.json());
    expect(body).toMatchObject({
      type: "action",
      icon: `${APP}/api/actions/icon`,
      title: expect.stringMatching(/^Freeze /),
      label: "Freeze agent",
    });
    expect(body.disabled).toBeUndefined();
  });

  for (const who of ["owner", "guardian"] as const) {
    it(`builds a transaction the ${who} signs, and it freezes the agent on-chain`, async () => {
      const signer = bed.keys[who];
      const transaction = await transactionOf(
        await postAction(h(), PATH, query(), { account: signer.address }),
      );
      await signAndSend(transaction, signer);
      const agent = await fetchAgentView(bed.chain, bed.accounts.agent);
      expect(agent).toMatchObject({ status: "frozen", freezeReason: who });
    });
  }

  it("refuses a stranger with 403, and the program refuses one too", async () => {
    const message = await errorOf(
      await postAction(h(), PATH, query(), { account: bed.keys.stranger.address }),
      403,
    );
    expect(message).toMatch(/owner or the guardian/);
    // Skipping the server's check changes nothing: the program checks the signer (01 §6.1).
    const direct = await buildFreezeAgent({
      authority: bed.keys.stranger,
      owner: bed.keys.owner.address,
      agent: bed.accounts.agent,
    });
    await expect(bed.send(bed.keys.stranger, [direct])).rejects.toThrow();
    expect(await fetchAgentView(bed.chain, bed.accounts.agent)).toMatchObject({ status: "active" });
  });

  it("is disabled once frozen, and POST answers 409", async () => {
    await signAndSend(
      await transactionOf(
        await postAction(h(), PATH, query(), { account: bed.keys.owner.address }),
      ),
      bed.keys.owner,
    );
    const body = ActionGetResponseSchema.parse(await (await getAction(h(), PATH, query())).json());
    expect(body.disabled).toBe(true);
    expect(body.description).toMatch(/already frozen/);
    await errorOf(await postAction(h(), PATH, query(), { account: bed.keys.owner.address }), 409);
  });

  it("answers 400 to a bad query or body, and 404 to an unknown agent", async () => {
    expect(await errorOf(await getAction(h(), PATH, { agent: "nope" }), 400)).toMatch(/\?agent=/);
    expect(await errorOf(await getAction(h(), PATH, {}), 400)).toMatch(/\?agent=/);
    await errorOf(await postAction(h(), PATH, query(), { account: "nope" }), 400);
    await errorOf(await postAction(h(), PATH, query(), "not json"), 400);
    await errorOf(await getAction(h(), PATH, { agent: bed.keys.stranger.address }), 404);
  });

  it("sends a browser to the agent's page", async () => {
    const response = await getAction(h(), PATH, query(), "text/html,application/xhtml+xml");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${APP}/app/agents/${bed.accounts.agent}`);
    expectActionHeaders(response);
  });

  it("answers OPTIONS with the headers", async () => {
    const response = await h().OPTIONS();
    expect(response.status).toBe(204);
    expectActionHeaders(response);
  });

  it("uses the request's origin when NEXT_PUBLIC_APP_URL is unset", async () => {
    const local = actionHandlers(freezeAction, () => ({ chain: bed.chain }));
    const response = await local.GET(
      new Request(`http://localhost:3000${PATH}?agent=${bed.accounts.agent}`),
    );
    expect((await response.json()).icon).toBe("http://localhost:3000/api/actions/icon");
  });
});

describe("freeze-all?owner=", () => {
  const PATH = "/api/actions/freeze-all";
  const h = () => handlers(freezeAllAction);
  const query = () => ({ owner: bed.keys.owner.address });

  it("describes the principal from the chain", async () => {
    const body = ActionGetResponseSchema.parse(await (await getAction(h(), PATH, query())).json());
    expect(body).toMatchObject({ title: "Freeze all agents", label: "Freeze all" });
    expect(body.description).toMatch(/^Pauses its 1 agent of this owner/);
  });

  for (const who of ["owner", "guardian"] as const) {
    it(`builds a transaction the ${who} signs, and it freezes the principal on-chain`, async () => {
      const signer = bed.keys[who];
      await signAndSend(
        await transactionOf(await postAction(h(), PATH, query(), { account: signer.address })),
        signer,
      );
      expect(await fetchPrincipalView(bed.chain, bed.keys.owner.address)).toMatchObject({
        frozen: true,
        frozenBy: signer.address,
      });
      const after = ActionGetResponseSchema.parse(
        await (await getAction(h(), PATH, query())).json(),
      );
      expect(after.disabled).toBe(true);
      await errorOf(await postAction(h(), PATH, query(), { account: signer.address }), 409);
    });
  }

  it("refuses a stranger with 403, and 404 for an owner without a principal", async () => {
    await errorOf(
      await postAction(h(), PATH, query(), { account: bed.keys.stranger.address }),
      403,
    );
    await errorOf(await getAction(h(), PATH, { owner: bed.keys.stranger.address }), 404);
  });

  it("sends a browser to the app", async () => {
    const response = await getAction(h(), PATH, query(), "text/html");
    expect(response.headers.get("location")).toBe(`${APP}/app`);
  });
});
