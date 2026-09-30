import { FETCH_BODY_MAX_CHARS } from "@leash/contracts";
import { z } from "zod";

// `browse`: a plain GET for free pages. It never pays; paid content goes through leash_fetch and
// the owner's policy. Injected instructions arrive here, as page text.

export const BROWSE_TOOL = {
  name: "browse",
  description:
    "Open a web page or API URL with a plain HTTP GET, free of charge. Returns the HTTP status, the content " +
    "type and the text (at most 20 000 characters). It never pays: if the service asks for payment (HTTP 402), " +
    "it says so and returns no content.",
  input_schema: {
    type: "object" as const,
    properties: { url: { type: "string", description: "An http or https URL" } },
    required: ["url"],
    additionalProperties: false,
  },
};

const BrowseInputSchema = z.strictObject({ url: z.url({ protocol: /^https?$/ }) });

export type BrowseOutput =
  | { ok: true; status: number; contentType: string; body: string }
  | { ok: false; error: string };

export const PAYMENT_REQUIRED_NOTE =
  "This URL requires payment (HTTP 402). browse does not pay, so no content was returned.";

/** Loads `input.url`. Expected failures come back as `{ ok: false }`, never as exceptions. */
export async function browse(
  input: unknown,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs = 20_000,
): Promise<BrowseOutput> {
  const parsed = BrowseInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "Invalid input: url must be an http or https URL." };
  let response: Response;
  try {
    response = await fetchImpl(parsed.data.url, {
      method: "GET",
      headers: {
        accept: "text/html, text/markdown, application/json, text/plain;q=0.9, */*;q=0.5",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, error: "The page could not be loaded (network error)." };
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 402) {
    await response.body?.cancel();
    return { ok: true, status: 402, contentType, body: PAYMENT_REQUIRED_NOTE };
  }
  const text = await response.text();
  const extra = text.length - FETCH_BODY_MAX_CHARS;
  return {
    ok: true,
    status: response.status,
    contentType,
    body:
      extra > 0
        ? `${text.slice(0, FETCH_BODY_MAX_CHARS)}\n\n[Truncated: ${extra} more characters]`
        : text,
  };
}
