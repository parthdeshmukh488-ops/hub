"use client";

import { CheckCircle2, ExternalLink, Loader2, Snowflake, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { shortAddress } from "../lib/format.ts";
import { signatureUrl } from "../lib/owner/chain.ts";
import type { OwnerPlan } from "../lib/owner/plans.ts";
import type { OwnerAction, OwnerActionState } from "../lib/owner/use-owner-action.ts";
import { cn } from "./cn.ts";

/**
 * The owner's view of one action: the plain-language summary before the wallet opens, then
 * signing, pending with its signature, confirmed with explorer links, or the failure in words.
 * Everything here is text: labels and memos inside the summary never render as HTML (T18).
 */
export function OwnerActionDialog({ action }: { action: OwnerAction }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { state } = action;
  const open = state.phase !== "idle";

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="owner-action-title"
      onCancel={(event) => {
        event.preventDefault();
        action.close();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-canvas p-0 text-fg shadow-xl backdrop:bg-black/40"
    >
      {open && <DialogBody action={action} state={state} />}
    </dialog>
  );
}

function DialogBody({ action, state }: { action: OwnerAction; state: OwnerActionState }) {
  const plan = "plan" in state ? state.plan : null;
  return (
    <div className="space-y-4 p-5">
      {state.phase === "preparing" ? (
        <Line icon="busy" title="Reading the latest state from the chain…" />
      ) : plan ? (
        <Summary plan={plan} />
      ) : null}

      {state.phase === "signing" && plan && (
        <Line icon="busy" title="Confirm in your wallet" detail={stepLabel(plan, state.step)} />
      )}
      {state.phase === "pending" && plan && (
        <Line
          icon="busy"
          title="Sent. Waiting for the network to confirm…"
          detail={`${stepLabel(plan, state.step)} · ${shortAddress(state.signature, 6)}`}
        />
      )}
      {state.phase === "confirmed" && (
        <div className="space-y-2">
          <Line
            icon="ok"
            title="Done. It's on-chain."
            detail="Your views update as the indexer sees it."
          />
          <ul className="space-y-1 text-sm">
            {state.signatures.map((signature) => (
              <li key={signature}>
                <a
                  href={signatureUrl(signature)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-brand underline"
                >
                  View {shortAddress(signature, 6)} on Solana Explorer
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.phase === "failed" && (
        <div role="alert">
          <Line
            icon="failed"
            title={plan ? "That didn't go through" : "Can't do that"}
            detail={state.message}
          />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {state.phase === "review" && (
          <>
            <button
              type="button"
              onClick={action.close}
              className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={action.confirm}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-canvas hover:opacity-90",
                state.plan.tone === "freeze" ? "bg-frozen" : "bg-brand",
              )}
            >
              {state.plan.tone === "freeze" && <Snowflake aria-hidden="true" className="size-4" />}
              {state.plan.confirmLabel}
            </button>
          </>
        )}
        {(state.phase === "confirmed" ||
          state.phase === "failed" ||
          state.phase === "preparing") && (
          <button
            type="button"
            onClick={action.close}
            className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}

function Summary({ plan }: { plan: OwnerPlan }) {
  return (
    <div className="space-y-2">
      <h2 id="owner-action-title" className="text-lg font-semibold leading-snug">
        {plan.summary}
      </h2>
      <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
        {plan.details.map((detail) => (
          <li key={detail}>{detail}</li>
        ))}
      </ul>
    </div>
  );
}

function stepLabel(plan: OwnerPlan, step: number): string {
  const purpose = plan.steps[step]?.purpose ?? "";
  return plan.steps.length > 1 ? `Step ${step + 1} of ${plan.steps.length}: ${purpose}` : purpose;
}

function Line({
  icon,
  title,
  detail,
}: {
  icon: "busy" | "ok" | "failed";
  title: string;
  detail?: string;
}) {
  const Icon = icon === "busy" ? Loader2 : icon === "ok" ? CheckCircle2 : XCircle;
  return (
    <div className="flex gap-3">
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-5 shrink-0",
          icon === "busy" && "animate-spin text-fg-muted",
          icon === "ok" && "text-ok",
          icon === "failed" && "text-blocked",
        )}
      />
      <div className="space-y-0.5">
        <p className={cn("font-medium", icon === "failed" && "text-blocked")}>{title}</p>
        {detail && <p className="text-sm text-fg-muted">{detail}</p>}
      </div>
    </div>
  );
}
