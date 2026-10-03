import { PairingScreen } from "../../screens/pairing-screen.tsx";

export const metadata = { title: "Pair an agent" };

/** The pairing link's landing page: `/pair?agentKey=…&label=…&preset=…&cluster=…` (02 §11). */
export default async function PairPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PairingScreen query={await searchParams} />;
}
