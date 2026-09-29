import type { AgentView } from "@leash/contracts";
import overviewJson from "@leash/contracts/fixtures/owner-overview.json";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentCard } from "../src/components/agent-card.tsx";
import { AllowanceGauge } from "../src/components/allowance-gauge.tsx";
import { FreezeSwitch } from "../src/components/freeze-switch.tsx";
import { StatusBadge } from "../src/components/tone.tsx";

const [research] = overviewJson.agents as unknown as [AgentView];
const NOW = 1_790_935_620;

describe("components", () => {
  it("never show a status by colour alone: icon and label", () => {
    const html = renderToStaticMarkup(<StatusBadge tone="blocked" label="Blocked" />);
    expect(html).toContain("<svg");
    expect(html).toContain("Blocked");
  });

  it("render labels as text, never as HTML (T18)", () => {
    const evil = { ...research, label: '<img src=x onerror="alert(1)">' };
    const html = renderToStaticMarkup(<AgentCard agent={evil} principalFrozen={false} now={NOW} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("expose the allowance as an accessible meter", () => {
    const html = renderToStaticMarkup(<AllowanceGauge allowance={research.allowance} now={NOW} />);
    expect(html).toContain("<meter");
    expect(html).toContain('value="30"');
    expect(html).toContain("3.46");
  });

  it("state the freeze in words and say why the switch is disabled", () => {
    const html = renderToStaticMarkup(
      <FreezeSwitch frozen label="Freeze this agent" disabledReason="Sample data is read-only" />,
    );
    expect(html).toContain("Frozen");
    expect(html).toContain("Sample data is read-only");
    expect(html).toContain("disabled");
  });
});
