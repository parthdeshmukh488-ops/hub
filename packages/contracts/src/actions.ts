import { z } from "zod";
import { AddressSchema, CAIP2 } from "./config.ts";

// Solana Actions (Blinks) served by apps/web (02-contracts §10). We define the types
// here instead of depending on @solana/actions, which pulls in web3.js v1 (ADR-0005).

export const ACTION_ROUTES = {
  freeze: "/api/actions/freeze",
  freezeAll: "/api/actions/freeze-all",
  approve: "/api/actions/approve",
  reject: "/api/actions/reject",
} as const;

/** Query parameters of each Action route. */
export const ActionQuerySchemas = {
  freeze: z.object({ agent: AddressSchema }),
  freezeAll: z.object({ owner: AddressSchema }),
  approve: z.object({ request: AddressSchema }),
  reject: z.object({ request: AddressSchema }),
} as const;

/** CORS headers every Action route returns. */
export const ACTIONS_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids",
  "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
} as const;

/** Value of `X-Blockchain-Ids` (devnet only). */
export const ACTIONS_BLOCKCHAIN_ID = CAIP2.devnet;

export const ActionsJsonSchema = z.object({
  rules: z.array(z.object({ pathPattern: z.string(), apiPath: z.string() })),
});
export type ActionsJson = z.infer<typeof ActionsJsonSchema>;

/** `GET /actions.json` content. */
export const ACTIONS_JSON: ActionsJson = {
  rules: [{ pathPattern: "/api/actions/**", apiPath: "/api/actions/**" }],
};

export const ActionGetResponseSchema = z.object({
  type: z.literal("action"),
  icon: z.url(),
  title: z.string(),
  description: z.string(),
  label: z.string(),
  disabled: z.boolean().optional(),
  error: z.object({ message: z.string() }).optional(),
});
export type ActionGetResponse = z.infer<typeof ActionGetResponseSchema>;

export const ActionPostRequestSchema = z.object({ account: AddressSchema });
export type ActionPostRequest = z.infer<typeof ActionPostRequestSchema>;

export const ActionPostResponseSchema = z.object({
  type: z.literal("transaction"),
  /** Base64 serialized v0 transaction, unsigned. */
  transaction: z.string().min(1),
  message: z.string().optional(),
});
export type ActionPostResponse = z.infer<typeof ActionPostResponseSchema>;

export const ActionErrorSchema = z.object({ message: z.string() });
export type ActionError = z.infer<typeof ActionErrorSchema>;
