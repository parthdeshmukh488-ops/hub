import { PROGRAM_IDS, SEEDS } from "@leash/contracts";
import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  findAgentPda,
  findDelegationPda,
  findLeashEventAuthorityPda,
  findPayeePda,
  findPrincipalPda,
  findRequestPda,
  findSubscriptionAuthorityPda,
  findSubscriptionsEventAuthorityPda,
  LEASH_PROGRAM_ADDRESS,
  SUBSCRIPTIONS_PROGRAM_ADDRESS,
} from "../src/index.ts";
import { testKeyAddress } from "../src/testing/index.ts";

// The PDA helpers against the seeds of 02-contracts §2.3, derived here independently.

const text = (seed: string) => new TextEncoder().encode(seed);
const address = getAddressEncoder();
const pda = async (programAddress: Address, seeds: (string | ReadonlyUint8Array)[]) =>
  (await getProgramDerivedAddress({ programAddress, seeds }))[0];

describe("program addresses", () => {
  it("are the ones @leash/contracts records", () => {
    expect(LEASH_PROGRAM_ADDRESS).toBe(PROGRAM_IDS.leash);
    expect(SUBSCRIPTIONS_PROGRAM_ADDRESS).toBe(PROGRAM_IDS.subscriptions);
  });
});

describe("PDAs", async () => {
  const owner = await testKeyAddress("owner");
  const agentKey = await testKeyAddress("agent");
  const merchant = await testKeyAddress("merchant");
  const mint = await testKeyAddress("mint");
  const principal = await findPrincipalPda(owner);
  const agent = await findAgentPda(principal, agentKey);

  it("derive the Leash accounts from their seeds", async () => {
    expect(principal).toBe(
      await pda(LEASH_PROGRAM_ADDRESS, [text(SEEDS.principal), address.encode(owner)]),
    );
    expect(agent).toBe(
      await pda(LEASH_PROGRAM_ADDRESS, [
        text(SEEDS.agent),
        address.encode(principal),
        address.encode(agentKey),
      ]),
    );
    expect(await findPayeePda(agent, merchant)).toBe(
      await pda(LEASH_PROGRAM_ADDRESS, [
        text(SEEDS.payee),
        address.encode(agent),
        address.encode(merchant),
      ]),
    );
    expect(await findRequestPda(agent, 7n)).toBe(
      await pda(LEASH_PROGRAM_ADDRESS, [
        text(SEEDS.request),
        address.encode(agent),
        getU64Encoder().encode(7n),
      ]),
    );
    expect(await findLeashEventAuthorityPda()).toBe(
      await pda(LEASH_PROGRAM_ADDRESS, [text(SEEDS.leashEventAuthority)]),
    );
  });

  it("give every request nonce its own account", async () => {
    const addresses = await Promise.all(
      [0n, 1n, 2n, 2n ** 64n - 1n].map((n) => findRequestPda(agent, n)),
    );
    expect(new Set(addresses).size).toBe(4);
  });

  it("derive the Subscriptions accounts from their seeds", async () => {
    const sa = await findSubscriptionAuthorityPda(owner, mint);
    expect(sa).toBe(
      await pda(SUBSCRIPTIONS_PROGRAM_ADDRESS, [
        text(SEEDS.subscriptionAuthority),
        address.encode(owner),
        address.encode(mint),
      ]),
    );
    const delegation = await findDelegationPda({ subscriptionAuthority: sa, owner, agent });
    expect(delegation).toBe(
      await pda(SUBSCRIPTIONS_PROGRAM_ADDRESS, [
        text(SEEDS.delegation),
        address.encode(sa),
        address.encode(owner),
        address.encode(agent),
        getU64Encoder().encode(0n),
      ]),
    );
    expect(
      await findDelegationPda({ subscriptionAuthority: sa, owner, agent, nonce: 1n }),
    ).not.toBe(delegation);
  });

  it("match the program's constant for Subscriptions' event authority", async () => {
    // programs/leash/src/constants.rs SUBSCRIPTIONS_EVENT_AUTHORITY
    expect(await findSubscriptionsEventAuthorityPda()).toBe(
      "3Hnj4BYoDgtpBuqXfiy7Y8cNa3jXaNd4oqgSXBzkMcH7",
    );
  });
});
