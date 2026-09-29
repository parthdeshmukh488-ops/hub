import { z } from "zod";
import {
  AgentStatusSchema,
  DenialReasonSchema,
  LEASH_ERRORS,
  RequestStatusSchema,
} from "./enums.ts";
import { AmountStringSchema, ReferenceHexSchema, UnixSecondsSchema } from "./units.ts";
import { PolicyViewSchema } from "./views.ts";

// Format of `test-vectors/policy.json` (02-contracts §14): shared cases for the policy
// evaluation of 01-onchain-program §7. WS1 runs them against the Rust evaluator and the
// program; WS2 runs them against the TypeScript evaluator. Both must agree on every case.
//
// Symbolic key names (e.g. "merchant") map to deterministic keypairs in every harness:
// the 32-byte ed25519 seed is sha256("leash:test-key:" + name).
//
// Time fields use on-chain semantics: 0 means "never started" (window starts) or
// "no expiry" (expiryTs). The policy uses its JSON view (validUntil null = no expiry).

export const TEST_KEY_SEED_PREFIX = "leash:test-key:";

const KeyNameSchema = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, "expected a camelCase key name");
const CountSchema = z.number().int().nonnegative();

const OwnerSchema = z.enum(["self", "other"]);

export const VectorAgentStateSchema = z.object({
  status: AgentStatusSchema,
  policy: PolicyViewSchema,
  stats: z.object({
    velocityWindowStart: UnixSecondsSchema,
    velocityCount: CountSchema,
    strikeWindowStart: UnixSecondsSchema,
    strikes: CountSchema,
  }),
});

export const VectorPayeeStateSchema = z.object({
  /** Which agent owns the entry: the paying agent ("self") or another one. */
  agent: OwnerSchema,
  payee: KeyNameSchema,
  maxPerPayment: AmountStringSchema,
  periodLimit: AmountStringSchema,
  periodSecs: CountSchema,
  periodStart: UnixSecondsSchema,
  spentInPeriod: AmountStringSchema,
});

export const VectorRequestStateSchema = z.object({
  agent: OwnerSchema,
  status: RequestStatusSchema,
  payee: KeyNameSchema,
  amount: AmountStringSchema,
  reference: ReferenceHexSchema,
  expiresAt: UnixSecondsSchema,
});

export const VectorDelegationStateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("recurring"),
    amountPerPeriod: AmountStringSchema,
    periodLengthSecs: z.number().int().positive(),
    currentPeriodStart: UnixSecondsSchema,
    pulledInPeriod: AmountStringSchema,
    expiryTs: UnixSecondsSchema,
  }),
  z.object({
    kind: z.literal("fixed"),
    amountRemaining: AmountStringSchema,
    expiryTs: UnixSecondsSchema,
  }),
]);

/** State after an allowed payment is applied. Only the listed fields are checked. */
export const VectorEffectsSchema = z
  .object({
    velocityWindowStart: UnixSecondsSchema,
    velocityCount: CountSchema,
    payeePeriodStart: UnixSecondsSchema,
    payeeSpentInPeriod: AmountStringSchema,
    delegationPeriodStart: UnixSecondsSchema,
    delegationPulledInPeriod: AmountStringSchema,
    delegationAmountRemaining: AmountStringSchema,
  })
  .partial();

export const VectorExpectSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("allowed"), effects: VectorEffectsSchema.optional() }),
  z.object({ outcome: z.literal("denied"), reason: DenialReasonSchema }),
  z.object({ outcome: z.literal("error"), error: z.enum(LEASH_ERRORS) }),
]);

export const PolicyTestCaseSchema = z.object({
  name: z.string().min(1),
  now: UnixSecondsSchema,
  principal: z.object({ frozen: z.boolean() }),
  agent: VectorAgentStateSchema,
  payee: VectorPayeeStateSchema.nullable(),
  request: VectorRequestStateSchema.nullable(),
  delegation: VectorDelegationStateSchema,
  sourceAmount: AmountStringSchema,
  payment: z.object({
    amount: AmountStringSchema,
    destinationOwner: KeyNameSchema,
    reference: ReferenceHexSchema,
  }),
  expect: VectorExpectSchema,
});
export type PolicyTestCase = z.infer<typeof PolicyTestCaseSchema>;

export const PolicyTestVectorsSchema = z
  .object({
    version: z.literal(1),
    description: z.string(),
    /** Symbolic key name → what it represents. */
    keys: z.record(KeyNameSchema, z.string()),
    cases: z.array(PolicyTestCaseSchema).min(1),
  })
  .superRefine((file, ctx) => {
    // zod 4 may run refinements on partially invalid input: guard before walking it.
    if (!Array.isArray(file.cases) || typeof file.keys !== "object" || file.keys === null) return;
    const seen = new Set<string>();
    for (const [index, testCase] of file.cases.entries()) {
      if (seen.has(testCase.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["cases", index, "name"],
          message: "duplicate case name",
        });
      }
      seen.add(testCase.name);
      const used = [
        testCase.payment.destinationOwner,
        testCase.payee?.payee,
        testCase.request?.payee,
      ].filter((k): k is string => k !== undefined);
      for (const key of used) {
        if (!(key in file.keys)) {
          ctx.addIssue({
            code: "custom",
            path: ["cases", index],
            message: `unknown key "${key}"`,
          });
        }
      }
    }
  });
export type PolicyTestVectors = z.infer<typeof PolicyTestVectorsSchema>;
