import { describe, expect, it } from "vitest";
import { waitForFacilitator } from "../src/facilitator.ts";

/** A fetch that gives each queued answer once; a thrown answer is a refused connection. */
function scripted(answers: Array<Response | Error>) {
  const urls: string[] = [];
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0]) => {
    urls.push(String(input));
    const answer = answers.shift();
    if (answer === undefined) throw new Error("no more answers");
    if (answer instanceof Error) throw answer;
    return answer;
  }) as typeof globalThis.fetch;
  return { fetch, urls };
}

describe("waitForFacilitator", () => {
  it("retries until /supported answers 200, reporting each wait", async () => {
    const { fetch, urls } = scripted([
      new TypeError("fetch failed"),
      new Response("starting", { status: 503 }),
      Response.json({ kinds: [] }),
    ]);
    const waits: number[] = [];
    const sleeps: number[] = [];
    await waitForFacilitator("http://localhost:4200/", {
      fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      onWaiting: (attempts) => waits.push(attempts),
      intervalMs: 250,
    });
    expect(urls).toEqual([
      "http://localhost:4200/supported",
      "http://localhost:4200/supported",
      "http://localhost:4200/supported",
    ]);
    expect(waits).toEqual([1, 2]);
    expect(sleeps).toEqual([250, 250]);
  });

  it("returns at once when the facilitator is up", async () => {
    const { fetch, urls } = scripted([Response.json({ kinds: [] })]);
    const sleeps: number[] = [];
    await waitForFacilitator("http://localhost:4200", {
      fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(urls).toEqual(["http://localhost:4200/supported"]);
    expect(sleeps).toEqual([]);
  });
});
