import Link from "next/link";

export default function AgentNotFound() {
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold">No agent at this address</h1>
      <p className="text-sm text-fg-muted">It may have been closed, or the link is wrong.</p>
      <Link href="/app" className="text-sm text-brand underline">
        Back to the overview
      </Link>
    </div>
  );
}
