import { loadContent } from "../src/content.ts";
import { createApp } from "../src/server.ts";

export const wallets = {
  merchant: "4gMnh13Pfx3twF8FpVp7bbGiZD9J4wyXWuCdKZnDVUT9",
  attacker: "3Ncik65BqWG53kphdKrYpXwagXiQwKHVmxGNB7ECRPzw",
};
export const content = loadContent();
export const app = createApp({ wallets, payments: "off" }, content);

export async function get(path: string, headers: Record<string, string> = {}) {
  const response = await app.request(`http://merchant.test${path}`, { headers });
  const text = await response.text();
  return { status: response.status, type: response.headers.get("content-type") ?? "", text };
}

export async function getJson<T = Record<string, unknown>>(path: string) {
  const response = await get(path);
  return { ...response, json: JSON.parse(response.text) as T };
}
