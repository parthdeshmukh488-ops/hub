import type { LeashEvent } from "@leash/contracts";
import { describe, expect, it } from "vitest";
import { allowanceView } from "../src/projection/allowance.ts";
import {
  type ProjectionContext,
  ProjectionError,
  project,
  pullFromDelegation,
} from "../src/projection/project.ts";
import type { AgentRecord, DelegationRecord } from "../src/projection/records.ts";
import { storyline } from "./helpers.ts";

// Program effects the storyline does not exercise (01-onchain-program §6.1, §7.2).

const T = 1_790_935_620;
const created = storyline.events.find((e) => e.type === "AgentCreated");
const principalEvent = storyline.events.find((e) => e.type === "PrincipalInitialized");
if (created?.type !== "AgentCreated" || principalEvent?.type !== "PrincipalInitialized") {
  throw new Error("storyline lacks the events these tests start from");
}
const base = {
  id: created.id,
  signature: created.signature,
  slot: 1,
  blockTime: T,
  timestamp: T,
  principal: created.principal,
  agent: created.agent,
};
const empty: ProjectionContext = {
  principal: null,
  agent: null,
  payee: null,
  request: null,
  delegation: null,
  payeeEntryAddress: null,
};

const principal = project(principalEvent, empty).principal ?? null;
const agent = project(created, { ...empty, principal }).agent as AgentRecord;

const at = (patch: Partial<AgentRecord>): ProjectionContext => ({
  ...empty,
  principal,
  agent: { ...agent, ...patch },
});
const ev = (body: object) => ({ ...base, ...body }) as LeashEvent;

describe("projections", () => {
  it("unfreezing resets strikes and their window", () => {
    const frozen = at({
      status: "frozen",
      freezeReason: "owner",
      stats: { ...agent.stats, strikes: 2, strikeWindowStart: T - 5 },
    });
    const next = project(ev({ type: "AgentUnfrozen" }), frozen).agent;
    expect(next).toMatchObject({
      status: "active",
      freezeReason: "none",
      frozenAt: null,
      updatedAt: T,
    });
    expect(next?.stats).toMatchObject({ strikes: 0, strikeWindowStart: null });
  });

  it("does not count strikes while frozen or with the tripwire off", () => {
    const denied = ev({
      type: "PaymentDenied",
      payee: "P",
      destination: "D",
      amount: "1",
      reason: "payeeNotAllowed",
      reasonCode: 4,
      strike: true,
      strikes: 1,
      tripped: false,
      reference: "00",
      memo: "",
    });
    expect(project(denied, at({ status: "frozen" })).agent?.stats).toMatchObject({
      strikes: 0,
      deniedCount: 1,
    });
    const off = at({ policy: { ...agent.policy, tripwireMaxStrikes: 0 } });
    expect(project(denied, off).agent?.stats).toMatchObject({
      strikes: 0,
      strikeWindowStart: null,
    });
  });

  it("does not track a switched-off rate limit", () => {
    const paid = ev({
      type: "PaymentExecuted",
      payee: "P",
      destination: "D",
      mint: "M",
      amount: "5",
      reference: "00",
      memo: "",
      delegation: "X",
      requestNonce: null,
      paymentsCount: 1,
    });
    const off = at({ policy: { ...agent.policy, velocityMaxPayments: 0 } });
    expect(project(paid, off).agent?.stats).toMatchObject({
      velocityCount: 0,
      velocityWindowStart: null,
      paymentsCount: 1,
      totalPaid: "5",
    });
  });

  it("keeps period counters when a payee's limits change, without touching the agent", () => {
    const payee = {
      address: "E",
      agent: agent.address,
      payee: "P",
      label: "Old",
      maxPerPayment: "1",
      periodLimit: "10",
      periodSecs: 60,
      periodStart: T - 10,
      spentInPeriod: "7",
      totalPaid: "7",
      paymentsCount: 2,
      createdAt: T - 100,
    };
    const changes = project(
      ev({
        type: "PayeeUpdated",
        payee: "P",
        label: "New",
        maxPerPayment: "2",
        periodLimit: "20",
        periodSecs: 120,
      }),
      { ...at({}), payee },
    );
    expect(changes.agent).toBeUndefined();
    expect(changes.payee).toEqual({
      ...payee,
      label: "New",
      maxPerPayment: "2",
      periodLimit: "20",
      periodSecs: 120,
    });
  });

  it("closes requests on reject and expiry, and closes agents", () => {
    const request = {
      address: "R",
      agent: agent.address,
      nonce: "0",
      payee: "P",
      amount: "1",
      reference: "00",
      memo: "",
      status: "pending" as const,
      createdAt: T,
      expiresAt: T + 60,
      approvedAt: null,
      rentPayer: agent.agentKey,
    };
    for (const type of ["RequestRejected", "RequestExpired"]) {
      const changes = project(ev({ type, request: "R", nonce: "0", by: "O" }), {
        ...at({ openRequests: 1 }),
        request,
      });
      expect(changes).toMatchObject({ request: null, agent: { openRequests: 0 } });
    }
    const closed = project(ev({ type: "AgentClosed" }), at({}));
    expect(closed.agent).toBeNull();
    expect(closed.principal?.agentCount).toBe((principal?.agentCount ?? 0) - 1);
  });

  it("refuses events for accounts it never saw", () => {
    expect(() => project(ev({ type: "AgentFrozen", reason: "owner", by: "O" }), empty)).toThrow(
      ProjectionError,
    );
    expect(() =>
      project(
        ev({
          type: "PayeeAdded",
          payee: "P",
          label: "L",
          maxPerPayment: "0",
          periodLimit: "0",
          periodSecs: 0,
        }),
        at({}),
      ),
    ).toThrow(/allowlist entry address/);
  });
});

describe("delegations", () => {
  const fixed: DelegationRecord = {
    kind: "fixed",
    address: "D",
    agent: "A",
    owner: "O",
    mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    amountRemaining: "10",
    expiresAt: null,
  };

  it("draws down a fixed delegation and refuses to overdraw it", () => {
    expect(pullFromDelegation(fixed, 4n, T)).toMatchObject({ amountRemaining: "6" });
    expect(() => pullFromDelegation(fixed, 11n, T)).toThrow(ProjectionError);
    expect(allowanceView(fixed, T)).toMatchObject({
      kind: "fixed",
      remaining: "10",
      amountRemaining: "10",
    });
  });

  it("rolls a recurring period forward before counting a pull", () => {
    const recurring: DelegationRecord = {
      kind: "recurring",
      address: "D",
      agent: "A",
      owner: "O",
      mint: fixed.mint,
      amountPerPeriod: "100",
      periodLengthSecs: 60,
      currentPeriodStart: T - 130,
      pulledInPeriod: "90",
      expiresAt: null,
    };
    expect(pullFromDelegation(recurring, 5n, T)).toMatchObject({
      currentPeriodStart: T - 10,
      pulledInPeriod: "5",
    });
    expect(() => pullFromDelegation({ ...recurring, currentPeriodStart: T + 1 }, 5n, T)).toThrow(
      /notStarted/,
    );
  });
});
