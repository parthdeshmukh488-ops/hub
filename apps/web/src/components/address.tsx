"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { shortAddress } from "../lib/format.ts";

/** A shortened address with the full value on hover and a copy button. */
export function Address({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied: the full address is still in the tooltip.
    }
  };
  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-xs text-fg-muted"
      title={address}
    >
      {shortAddress(address)}
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : `Copy address ${address}`}
        className="rounded p-0.5 hover:bg-surface-2 hover:text-fg"
      >
        {copied ? (
          <Check aria-hidden="true" className="size-3" />
        ) : (
          <Copy aria-hidden="true" className="size-3" />
        )}
      </button>
    </span>
  );
}
