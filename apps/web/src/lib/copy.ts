/** Why switches and buttons are disabled for now. */
export function readOnlyReason(source: "fixtures" | "indexer"): string {
  return source === "fixtures"
    ? "Sample data is read-only"
    : "Changes need a connected wallet (coming soon)";
}
