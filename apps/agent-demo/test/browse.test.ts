import { FETCH_BODY_MAX_CHARS } from "@leash/contracts";
import { describe, expect, it, vi } from "vitest";
import { BROWSE_TOOL, browse, PAYMENT_REQUIRED_NOTE } from "../src/browse.ts";

const respond = (body: string, status = 200, type = "text/html; charset=utf-8") =>
  vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(body, { status, headers: { "content-type": type } }),
  );

describe("browse", () => {
  it("fetches a free page with a plain GET and returns its text", async () => {
    const fetch = respond("<h1>Guide</h1>");
    expect(await browse({ url: "http://merchant.test/lab" }, fetch)).toEqual({
      ok: true,
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<h1>Guide</h1>",
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("http://merchant.test/lab");
    expect(init).toMatchObject({ method: "GET" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("never pays: a 402 comes back as a note, without the content", async () => {
    expect(
      await browse({ url: "https://m.example/paid" }, respond("secret", 402, "application/json")),
    ).toEqual({
      ok: true,
      status: 402,
      contentType: "application/json",
      body: PAYMENT_REQUIRED_NOTE,
    });
    expect(BROWSE_TOOL.description).toContain("It never pays");
  });

  it("cuts long pages at the same limit as leash_fetch, and says so", async () => {
    const page = "x".repeat(FETCH_BODY_MAX_CHARS + 5);
    const out = await browse({ url: "https://m.example/" }, respond(page, 200, ""));
    expect(out.ok && out.body).toBe(
      `${"x".repeat(FETCH_BODY_MAX_CHARS)}\n\n[Truncated: 5 more characters]`,
    );
    expect(out.ok && out.contentType).toBe("");
  });

  it("answers bad input and network failures without throwing", async () => {
    const fetch = respond("");
    for (const input of [
      { url: "ftp://m.example/" },
      { url: "not a url" },
      {},
      { url: "https://m.example", x: 1 },
      null,
    ]) {
      expect(await browse(input, fetch)).toEqual({
        ok: false,
        error: "Invalid input: url must be an http or https URL.",
      });
    }
    expect(fetch).not.toHaveBeenCalled();
    const down = vi.fn(async () => Promise.reject(new TypeError("fetch failed")));
    expect(await browse({ url: "https://m.example/" }, down)).toEqual({
      ok: false,
      error: "The page could not be loaded (network error).",
    });
  });
});
