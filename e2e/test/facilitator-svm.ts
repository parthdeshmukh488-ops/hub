import type { Testbed } from "@leash/sdk/testing";
import { FailedTransactionMetadata, type LiteSVM } from "litesvm";

/**
 * The testbed's LiteSVM, for the x402 facilitator, with every transaction it sends also recorded
 * in the testbed chain's history.
 *
 * Why: `litesvmFacilitatorSigner` (`@leash/x402/testing`) sends straight to LiteSVM, and the
 * testbed chain (`@leash/sdk/testing`) lists only the transactions sent through its own
 * `sendAndConfirm`. On a real cluster both go to the same node and the indexer sees every
 * settlement; here it would miss them.
 *
 * How: the transaction runs once, on LiteSVM. Its result is then handed to the chain's
 * `sendAndConfirm`, which records it without running it again: for that one synchronous call,
 * `svm.sendTransaction` returns the result instead of executing. (`sendAndConfirm` does all its
 * work before its first `await`, so the swap never leaks into another call.)
 */
export function recordingSvm(bed: Testbed): LiteSVM {
  const svm = bed.svm;
  return new Proxy(svm, {
    get(target, property) {
      if (property === "sendTransaction") {
        return (transaction: Parameters<LiteSVM["sendTransaction"]>[0]) => {
          const result = target.sendTransaction(transaction);
          if (result instanceof FailedTransactionMetadata) return result;
          const own = Object.getOwnPropertyDescriptor(target, "sendTransaction");
          Object.defineProperty(target, "sendTransaction", {
            value: () => result,
            configurable: true,
            writable: true,
          });
          try {
            bed.chain
              .sendAndConfirm(transaction as Parameters<Testbed["chain"]["sendAndConfirm"]>[0])
              .catch((error: unknown) => {
                throw new Error(`could not record a facilitator transaction: ${String(error)}`);
              });
          } finally {
            if (own) Object.defineProperty(target, "sendTransaction", own);
            else delete (target as { sendTransaction?: unknown }).sendTransaction;
          }
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
