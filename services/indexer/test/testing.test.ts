import {
  EventsPageResponseSchema,
  GuardianOwnersResponseSchema,
  OwnerOverviewResponseSchema,
  type StreamServerMessage,
  StreamServerMessageSchema,
} from "@leash/contracts";
import { LEASH_PROGRAM_ADDRESS, LeashAgent } from "@leash/sdk";
import { createTestbed, USDC } from "@leash/sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { startTestIndexer, type TestIndexer } from "../src/testing.ts";
import { key, storyline } from "./helpers.ts";

// `@leash/indexer/testing` as another package's test uses it: over HTTP and the stream only.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function started(...args: Parameters<typeof startTestIndexer>): Promise<TestIndexer> {
  const indexer = await startTestIndexer(...args);
  cleanups.push(indexer.close);
  return indexer;
}

async function get(indexer: TestIndexer, path: string): Promise<unknown> {
  const response = await fetch(`${indexer.url}${path}`);
  expect(response.status).toBe(200);
  return response.json();
}

/** A stream client subscribed to `owners`, once the server has handled the subscription. */
async function subscribed(indexer: TestIndexer, owners: string[]) {
  const socket = new WebSocket(indexer.streamUrl);
  const messages: StreamServerMessage[] = [];
  socket.on("message", (data) =>
    messages.push(StreamServerMessageSchema.parse(JSON.parse(data.toString()))),
  );
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  cleanups.push(async () => socket.close());
  socket.send(JSON.stringify({ type: "subscribe", owners }));
  // The server handles one socket's messages in order and answers garbage with an error, so the
  // error means the subscription is in place.
  socket.send("barrier");
  await vi.waitFor(() => expect(messages.some((m) => m.type === "error")).toBe(true));
  return messages;
}

describe("@leash/indexer/testing", () => {
  it("serves the storyline over REST and the stream, starting when the test says so", async () => {
    const indexer = await started({ startNow: false });
    const owners = () => get(indexer, `/v1/guardians/${key("guardian")}/owners`);
    expect(GuardianOwnersResponseSchema.parse(await owners())).toEqual({ owners: [] });

    const messages = await subscribed(indexer, [key("owner")]);
    await indexer.start();
    const streamed = () => messages.flatMap((m) => (m.type === "event" ? [m.event.type] : []));
    await vi.waitFor(() => expect(streamed()).toEqual(storyline.events.map((event) => event.type)));
    expect(GuardianOwnersResponseSchema.parse(await owners())).toEqual({
      owners: [key("owner")],
    });
  });

  it("follows a LiteSVM chain only when the test calls sync()", async () => {
    const bed = await createTestbed();
    const owner = bed.keys.owner.address;
    const indexer = await started({
      source: { kind: "chain", chain: bed.chain, programId: LEASH_PROGRAM_ADDRESS },
      now: () => Number(bed.now()),
    });
    // The first poll stored the testbed's onboarding.
    const overview = OwnerOverviewResponseSchema.parse(await get(indexer, `/v1/owners/${owner}`));
    expect(overview.principal?.owner).toBe(owner);
    expect(overview.agents.map((agent) => agent.address)).toEqual([bed.accounts.agent]);

    const agent = new LeashAgent({
      chain: bed.chain,
      signer: bed.keys.agentKey,
      owner,
      logger: { warn: () => {} },
    });
    await agent.pay({ to: bed.keys.merchant.address, amount: USDC, purpose: "Research" });
    const payments = async () =>
      EventsPageResponseSchema.parse(
        await get(indexer, `/v1/owners/${owner}/events?types=PaymentExecuted`),
      ).items;
    expect(await payments()).toEqual([]);

    expect((await indexer.sync()).processed).toBeGreaterThan(0);
    expect(await payments()).toMatchObject([{ type: "PaymentExecuted", amount: "1000000" }]);
    expect((await indexer.sync()).processed).toBe(0);
  });
});
