"use client";

import { POLICY_PRESETS, PRESET_IDS, type PresetId } from "@leash/contracts";
import { useQuery } from "@tanstack/react-query";
import { Fingerprint, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useId, useState } from "react";
import { Card } from "../components/card.tsx";
import { cn } from "../components/cn.ts";
import { OwnerActionDialog } from "../components/owner-action-dialog.tsx";
import { getDataSource } from "../data/index.ts";
import { useViewerOwner, useWriteBlocker } from "../data/viewer.ts";
import { env } from "../env.ts";
import { clusterConfig } from "../lib/owner/chain.ts";
import { planOnboarding } from "../lib/owner/plans.ts";
import { useOwnerAction } from "../lib/owner/use-owner-action.ts";
import {
  emptyPayee,
  formFromPreset,
  keyFingerprint,
  type PairingErrors,
  type PairingForm,
  type PairingHints,
  type ParsedPairing,
  parsePairingForm,
  readPairingLink,
  reviewLines,
} from "../lib/pairing.ts";

type Query = Record<string, string | string[] | undefined>;

/**
 * The pairing wizard (02-contracts §11): from a pairing link (`/pair?agentKey=…`) or by hand
 * (`/app/agents/new`). The owner checks the agent key's fingerprint, adjusts the preset, reads
 * the plain-language review and signs. The program enforces every limit; the form only helps.
 */
export function PairingScreen({ query }: { query: Query | null }) {
  const owner = useViewerOwner();
  const hints = usePairingHints(owner);
  if (hints.isPending) {
    return <p className="text-sm text-fg-muted">Loading…</p>;
  }
  return <Wizard query={query} hints={hints.data ?? {}} owner={owner} />;
}

function Wizard({
  query,
  hints,
  owner,
}: {
  query: Query | null;
  hints: PairingHints;
  owner: string;
}) {
  const router = useRouter();
  const link = query ? readPairingLink(query) : null;
  const linked = link?.ok ? link : null;
  const [preset, setPreset] = useState<PresetId>(linked?.preset ?? "research-assistant");
  const [form, setForm] = useState<PairingForm>(() =>
    formFromPreset(preset, { agentKey: linked?.agentKey ?? "", label: linked?.label ?? "" }, hints),
  );
  const [errors, setErrors] = useState<PairingErrors>({});
  const [review, setReview] = useState<ParsedPairing | null>(null);
  const writeBlocker = useWriteBlocker();
  const action = useOwnerAction({
    owner,
    onConfirmed: (plan) => {
      if (plan.agent) router.push(`/app/agents/${plan.agent}`);
    },
  });
  const appCluster = env.NEXT_PUBLIC_LEASH_CLUSTER;
  const wrongCluster = linked && linked.cluster !== appCluster ? linked.cluster : null;

  const update = (patch: Partial<PairingForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setReview(null);
  };
  const choosePreset = (next: PresetId) => {
    setPreset(next);
    setForm((current) =>
      formFromPreset(next, { agentKey: current.agentKey, label: current.label }, hints),
    );
    setErrors({});
    setReview(null);
  };
  const toReview = () => {
    const parsed = parsePairingForm(form);
    if (parsed.ok) {
      setErrors({});
      setReview(parsed.value);
    } else {
      setErrors(parsed.errors);
      setReview(null);
    }
  };
  const signBlocker = wrongCluster
    ? `This link is for ${wrongCluster}; this app runs on ${appCluster}.`
    : writeBlocker;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Pair an agent</h1>
        <p className="text-sm text-fg-muted">
          Give an agent a budget and rules. Your money stays in your wallet; the agent can only
          spend what the rules allow, and you can freeze it at any time.
        </p>
      </div>

      {link && !link.ok && (
        <Notice tone="blocked" title="This pairing link is not valid">
          <ul className="list-disc pl-5">
            {link.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <p>You can still fill everything in by hand below.</p>
        </Notice>
      )}
      {wrongCluster && (
        <Notice tone="blocked" title={`This link is for ${wrongCluster}`}>
          <p>
            The agent waits on {wrongCluster}, but this app runs on {appCluster}. Open the link in
            the {wrongCluster} app, or restart the agent on {appCluster}.
          </p>
        </Notice>
      )}

      <Card id="agent-heading" title="1 · The agent">
        <div className="space-y-4">
          <Field
            label="Agent key"
            hint="The public key your agent printed."
            error={errors.agentKey}
          >
            {(id) => (
              <input
                id={id}
                value={form.agentKey}
                onChange={(e) => update({ agentKey: e.target.value.trim() })}
                spellCheck={false}
                className={inputClass(errors.agentKey)}
              />
            )}
          </Field>
          {form.agentKey.length >= 32 && <FingerprintCard agentKey={form.agentKey} />}
          <Field label="Name" hint="Shown to you only; at most 32 bytes." error={errors.label}>
            {(id) => (
              <input
                id={id}
                value={form.label}
                onChange={(e) => update({ label: e.target.value })}
                className={inputClass(errors.label)}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card id="rules-heading" title="2 · Budget and rules">
        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Start from a preset</legend>
            <div className="flex flex-wrap gap-2">
              {PRESET_IDS.map((id) => (
                <label
                  key={id}
                  className={cn(
                    "cursor-pointer rounded-lg border px-3 py-2 text-sm",
                    preset === id ? "border-brand bg-surface-2 font-medium" : "border-line",
                  )}
                >
                  <input
                    type="radio"
                    name="preset"
                    value={id}
                    checked={preset === id}
                    onChange={() => choosePreset(id)}
                    className="sr-only"
                  />
                  {POLICY_PRESETS[id].name}
                </label>
              ))}
            </div>
            <p className="text-xs text-fg-muted">{POLICY_PRESETS[preset].description}</p>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Allowance (USDC)" error={errors.allowancePerPeriod}>
              {(id) => (
                <input
                  id={id}
                  inputMode="decimal"
                  value={form.allowancePerPeriod}
                  onChange={(e) => update({ allowancePerPeriod: e.target.value })}
                  className={inputClass(errors.allowancePerPeriod)}
                />
              )}
            </Field>
            <Field label="Every" error={errors.allowancePeriodSecs}>
              {(id) => (
                <select
                  id={id}
                  value={form.allowancePeriodSecs}
                  onChange={(e) => update({ allowancePeriodSecs: e.target.value })}
                  className={inputClass(errors.allowancePeriodSecs)}
                >
                  <option value="3600">hour</option>
                  <option value="86400">day</option>
                  <option value="604800">week</option>
                  <option value="2592000">30 days</option>
                </select>
              )}
            </Field>
            <Field label="Ends after (days)" hint="0 = never" error={errors.allowanceDays}>
              {(id) => (
                <input
                  id={id}
                  inputMode="numeric"
                  value={form.allowanceDays}
                  onChange={(e) => update({ allowanceDays: e.target.value })}
                  className={inputClass(errors.allowanceDays)}
                />
              )}
            </Field>
            <Field label="Per payment, without asking (USDC)" error={errors.maxPerPayment}>
              {(id) => (
                <input
                  id={id}
                  inputMode="decimal"
                  value={form.maxPerPayment}
                  onChange={(e) => update({ maxPerPayment: e.target.value })}
                  className={inputClass(errors.maxPerPayment)}
                />
              )}
            </Field>
            <Field
              label="Ask me up to (USDC)"
              hint="0 = never ask, block instead"
              error={errors.maxPerRequest}
            >
              {(id) => (
                <input
                  id={id}
                  inputMode="decimal"
                  value={form.maxPerRequest}
                  onChange={(e) => update({ maxPerRequest: e.target.value })}
                  className={inputClass(errors.maxPerRequest)}
                />
              )}
            </Field>
            <Field label="Requests expire after (s)" error={errors.requestTtlSecs}>
              {(id) => (
                <input
                  id={id}
                  inputMode="numeric"
                  value={form.requestTtlSecs}
                  onChange={(e) => update({ requestTtlSecs: e.target.value })}
                  className={inputClass(errors.requestTtlSecs)}
                />
              )}
            </Field>
            <Field label="Max payments" hint="0 = no rate limit" error={errors.velocityMaxPayments}>
              {(id) => (
                <input
                  id={id}
                  inputMode="numeric"
                  value={form.velocityMaxPayments}
                  onChange={(e) => update({ velocityMaxPayments: e.target.value })}
                  className={inputClass(errors.velocityMaxPayments)}
                />
              )}
            </Field>
            <Field label="…per (s)" error={errors.velocityWindowSecs}>
              {(id) => (
                <input
                  id={id}
                  inputMode="numeric"
                  value={form.velocityWindowSecs}
                  onChange={(e) => update({ velocityWindowSecs: e.target.value })}
                  className={inputClass(errors.velocityWindowSecs)}
                />
              )}
            </Field>
            <div />
            <Field
              label="Tripwire strikes"
              hint="0 = tripwire off"
              error={errors.tripwireMaxStrikes}
            >
              {(id) => (
                <input
                  id={id}
                  inputMode="numeric"
                  value={form.tripwireMaxStrikes}
                  onChange={(e) => update({ tripwireMaxStrikes: e.target.value })}
                  className={inputClass(errors.tripwireMaxStrikes)}
                />
              )}
            </Field>
            <Field label="…within (s)" error={errors.tripwireWindowSecs}>
              {(id) => (
                <input
                  id={id}
                  inputMode="numeric"
                  value={form.tripwireWindowSecs}
                  onChange={(e) => update({ tripwireWindowSecs: e.target.value })}
                  className={inputClass(errors.tripwireWindowSecs)}
                />
              )}
            </Field>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Who it may pay</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.allowListOnly}
                onChange={(e) => update({ allowListOnly: e.target.checked })}
              />
              Only the payees below (recommended)
            </label>
            {!form.allowListOnly && (
              <p className="flex items-center gap-2 text-sm text-approval">
                <ShieldAlert aria-hidden="true" className="size-4" />
                The agent may then pay anyone, within its limits.
              </p>
            )}
            {errors.payees && <p className="text-sm text-blocked">{errors.payees}</p>}
            {form.payees.map((payee, i) => (
              <PayeeRow
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity until typed
                key={i}
                index={i}
                payee={payee}
                errors={errors}
                onChange={(patch) =>
                  update({
                    payees: form.payees.map((p, j) => (j === i ? { ...p, ...patch } : p)),
                  })
                }
                onRemove={() => update({ payees: form.payees.filter((_, j) => j !== i) })}
              />
            ))}
            <button
              type="button"
              onClick={() => update({ payees: [...form.payees, emptyPayee()] })}
              className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2"
            >
              <Plus aria-hidden="true" className="size-4" /> Add a payee
            </button>
          </fieldset>

          <Field
            label="Token mint"
            hint={`The token the agent pays with (USDC on ${appCluster}).`}
            error={errors.mint}
          >
            {(id) => (
              <input
                id={id}
                value={form.mint}
                onChange={(e) => update({ mint: e.target.value.trim() })}
                spellCheck={false}
                className={inputClass(errors.mint)}
              />
            )}
          </Field>

          <button
            type="button"
            onClick={toReview}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-canvas hover:opacity-90"
          >
            Review
          </button>
          {Object.keys(errors).length > 0 && (
            <p role="alert" className="text-sm text-blocked">
              Some fields need a look; they are marked above.
            </p>
          )}
        </div>
      </Card>

      {review && (
        <Card id="review-heading" title="3 · Review and sign">
          <div className="space-y-4">
            <ul className="space-y-2 text-sm">
              {reviewLines(review).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <FingerprintCard agentKey={review.agentKey} compact />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={signBlocker !== null}
                onClick={() =>
                  action.start(({ chain, signer }) =>
                    planOnboarding(chain, {
                      signer,
                      ...review,
                      guardian: null,
                      review: reviewLines(review),
                    }),
                  )
                }
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-canvas hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Sign and pair
              </button>
              {signBlocker && <p className="text-sm text-fg-muted">{signBlocker}</p>}
            </div>
          </div>
        </Card>
      )}
      <OwnerActionDialog action={action} />
    </div>
  );
}

function FingerprintCard({ agentKey, compact = false }: { agentKey: string; compact?: boolean }) {
  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Fingerprint aria-hidden="true" className="size-4" />
        Agent key fingerprint
      </p>
      <p className="sr-only">{agentKey}</p>
      <p
        aria-hidden="true"
        data-testid="fingerprint"
        className="flex flex-wrap gap-1.5 font-mono text-sm"
      >
        {keyFingerprint(agentKey).map((group, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: groups repeat; their place is the key
          <span key={i} className="rounded bg-canvas px-1.5 py-0.5">
            {group}
          </span>
        ))}
      </p>
      {!compact && (
        <p className="text-xs text-fg-muted">
          Compare every group with the key your agent's terminal shows. If one differs, stop: the
          link was not made by your agent.
        </p>
      )}
    </div>
  );
}

function PayeeRow({
  index,
  payee,
  errors,
  onChange,
  onRemove,
}: {
  index: number;
  payee: PairingForm["payees"][number];
  errors: PairingErrors;
  onChange: (patch: Partial<PairingForm["payees"][number]>) => void;
  onRemove: () => void;
}) {
  const at = (field: string) => errors[`payees.${index}.${field}`];
  return (
    <div className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-6">
      <Field label="Payee name" error={at("label")} className="sm:col-span-2">
        {(id) => (
          <input
            id={id}
            value={payee.label}
            onChange={(e) => onChange({ label: e.target.value })}
            className={inputClass(at("label"))}
          />
        )}
      </Field>
      <Field label="Payee wallet" error={at("address")} className="sm:col-span-4">
        {(id) => (
          <input
            id={id}
            value={payee.address}
            onChange={(e) => onChange({ address: e.target.value.trim() })}
            spellCheck={false}
            className={inputClass(at("address"))}
          />
        )}
      </Field>
      <Field
        label="Max per payment (USDC)"
        hint="0 = no cap"
        error={at("maxPerPayment")}
        className="sm:col-span-2"
      >
        {(id) => (
          <input
            id={id}
            inputMode="decimal"
            value={payee.maxPerPayment}
            onChange={(e) => onChange({ maxPerPayment: e.target.value })}
            className={inputClass(at("maxPerPayment"))}
          />
        )}
      </Field>
      <Field
        label="Budget (USDC)"
        hint="0 = no budget"
        error={at("periodLimit")}
        className="sm:col-span-2"
      >
        {(id) => (
          <input
            id={id}
            inputMode="decimal"
            value={payee.periodLimit}
            onChange={(e) => onChange({ periodLimit: e.target.value })}
            className={inputClass(at("periodLimit"))}
          />
        )}
      </Field>
      <Field label="…per (s)" error={at("periodSecs")}>
        {(id) => (
          <input
            id={id}
            inputMode="numeric"
            value={payee.periodSecs}
            onChange={(e) => onChange({ periodSecs: e.target.value })}
            className={inputClass(at("periodSecs"))}
          />
        )}
      </Field>
      <div className="flex items-end">
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove payee ${payee.label || index + 1}`}
          className="rounded-lg p-2 text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  className?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-xs text-blocked">{error}</p>
      ) : (
        hint && <p className="text-xs text-fg-muted">{hint}</p>
      )}
    </div>
  );
}

const inputClass = (error: string | undefined) =>
  cn(
    "w-full rounded-lg border bg-canvas px-3 py-2 text-sm",
    error ? "border-blocked" : "border-line",
  );

function Notice({
  tone,
  title,
  children,
}: {
  tone: "blocked";
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "space-y-2 rounded-2xl border bg-surface p-4 text-sm",
        tone === "blocked" && "border-blocked/40",
      )}
    >
      <p className="font-semibold">{title}</p>
      {children}
    </div>
  );
}

/**
 * What the wizard can fill in for the owner: the cluster's USDC mint (or the mint the owner's
 * agents already use) and the demo merchant (a payee the owner's agents already have under the
 * preset's label). Read from the configured data source; the owner still sees and can change both.
 */
function usePairingHints(owner: string) {
  return useQuery({
    queryKey: [owner, "pairing-hints"],
    queryFn: async (): Promise<PairingHints> => {
      const source = getDataSource();
      const overview = await source.overview(owner).catch(() => null);
      const agents = overview?.agents ?? [];
      const mint = clusterConfig().usdcMint ?? agents[0]?.mint;
      const wanted = new Set(
        Object.values(POLICY_PRESETS).flatMap((p) => p.payees.map((payee) => payee.label)),
      );
      let merchant: string | undefined;
      for (const agent of agents) {
        const detail = await source.agent(owner, agent.address).catch(() => null);
        merchant = detail?.payees.find((p) => wanted.has(p.label))?.payee;
        if (merchant) break;
      }
      return { ...(mint ? { mint } : {}), ...(merchant ? { merchant } : {}) };
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}
