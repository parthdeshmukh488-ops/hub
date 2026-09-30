import { AgentScreen } from "../../../../screens/agent-screen.tsx";

export const metadata = { title: "Agent" };

export default async function AgentPage({ params }: { params: Promise<{ agent: string }> }) {
  const { agent } = await params;
  return <AgentScreen address={agent} />;
}
