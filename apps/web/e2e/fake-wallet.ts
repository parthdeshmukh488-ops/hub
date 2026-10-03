// A Wallet Standard wallet for the browser tests, backed by a test keypair: it registers itself
// like Phantom or Solflare do, connects without a prompt, and signs Solana transactions with
// WebCrypto Ed25519. Injected with `page.addInitScript`. Test code only; never ship a key.

export type FakeWalletOptions = {
  /** The 32-byte Ed25519 seed (a deterministic test key). */
  seed: Uint8Array;
  /** The public key that seed gives. */
  publicKey: Uint8Array;
  /** Its base58 address. */
  address: string;
  /** Wallet Standard chains the account lists, e.g. ["solana:localnet"]. */
  chains: string[];
  name?: string;
};

/** The init script: run in the page before any app code. */
export function fakeWalletScript(options: FakeWalletOptions): string {
  const config = JSON.stringify({
    seed: [...options.seed],
    publicKey: [...options.publicKey],
    address: options.address,
    chains: options.chains,
    name: options.name ?? "Leash Test Wallet",
  });
  return `(${install.toString()})(${config});`;
}

type InstallConfig = {
  seed: number[];
  publicKey: number[];
  address: string;
  chains: string[];
  name: string;
};

// Runs in the browser. Self-contained: no imports, no closures over Node values.
function install(config: InstallConfig): void {
  const w = window as unknown as Record<string, unknown> & Window;
  const PKCS8_PREFIX = [
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ];
  const keyPromise = crypto.subtle.importKey(
    "pkcs8",
    new Uint8Array([...PKCS8_PREFIX, ...config.seed]),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const listeners: Record<string, Set<(properties: unknown) => void>> = { change: new Set() };
  const log = { connects: 0, signed: 0, declineNext: false };
  w.__leashTestWallet = log;

  const account = {
    address: config.address,
    publicKey: new Uint8Array(config.publicKey),
    chains: config.chains,
    features: ["solana:signTransaction"],
    label: "Test owner",
    icon: undefined,
  };

  const readShortVec = (bytes: Uint8Array, at: number): [number, number] => {
    let value = 0;
    let size = 0;
    for (;;) {
      const byte = bytes[at + size] ?? 0;
      value |= (byte & 0x7f) << (7 * size);
      size += 1;
      if ((byte & 0x80) === 0) return [value, size];
    }
  };

  async function sign(wire: Uint8Array): Promise<Uint8Array> {
    const out = new Uint8Array(wire);
    const [signatureCount, prefix] = readShortVec(out, 0);
    const messageStart = prefix + signatureCount * 64;
    const message = out.slice(messageStart);
    let at = 0;
    if ((message[0] ?? 0) & 0x80) at += 1; // versioned message
    const requiredSignatures = message[at] ?? 0;
    at += 3;
    const [, keysPrefix] = readShortVec(message, at);
    at += keysPrefix;
    let index = -1;
    for (let i = 0; i < requiredSignatures; i++) {
      const key = message.slice(at + i * 32, at + i * 32 + 32);
      if (key.every((byte, j) => byte === config.publicKey[j])) index = i;
    }
    if (index < 0) throw new Error("This transaction does not need the test wallet's signature");
    const signature = new Uint8Array(
      await crypto.subtle.sign("Ed25519", await keyPromise, message),
    );
    out.set(signature, prefix + index * 64);
    return out;
  }

  const wallet = {
    version: "1.0.0",
    name: config.name,
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzRhNWE3OCIvPjwvc3ZnPg==",
    chains: config.chains,
    accounts: [] as (typeof account)[],
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async (input?: { silent?: boolean }) => {
          // Like a real wallet: a silent connect only succeeds for an app it already trusts.
          if (input?.silent && localStorage.getItem("leash-test-wallet:trusted") !== "yes") {
            return { accounts: [] };
          }
          localStorage.setItem("leash-test-wallet:trusted", "yes");
          log.connects += 1;
          wallet.accounts = [account];
          for (const listener of listeners.change ?? []) listener({ accounts: wallet.accounts });
          return { accounts: wallet.accounts };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          wallet.accounts = [];
          for (const listener of listeners.change ?? []) listener({ accounts: wallet.accounts });
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (event: string, listener: (properties: unknown) => void) => {
          listeners[event] ??= new Set();
          listeners[event]?.add(listener);
          return () => listeners[event]?.delete(listener);
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs: { transaction: Uint8Array }[]) => {
          if (log.declineNext) {
            log.declineNext = false;
            throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          }
          const outputs = [];
          for (const input of inputs) {
            outputs.push({ signedTransaction: await sign(input.transaction) });
            log.signed += 1;
          }
          return outputs;
        },
      },
    },
  };

  const callback = ({ register }: { register: (wallet: unknown) => void }) => register(wallet);
  window.addEventListener("wallet-standard:app-ready", (event) =>
    callback((event as CustomEvent).detail),
  );
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: callback }));
}
