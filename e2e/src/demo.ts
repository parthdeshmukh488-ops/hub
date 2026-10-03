import { pathToFileURL } from "node:url";
import { styleText } from "node:util";
import { STORYLINE } from "@leash/agent-demo/scenes";
import { type Alert, formatUsdc } from "@leash/contracts";
import { formatAlert } from "@leash/sentinel";
import { startStack, waitFor } from "./stack.ts";

// `pnpm demo`: the whole pitch story in one command, in the terminal, with no validator, keys or
// network. The real leash.so and subscriptions.so run on LiteSVM; merchant-demo takes x402
// payments through the official facilitator; the demo agent replays its scene scripts through its
// real tools; the indexer follows the chain and Sentinel prints its alerts. Nobody is holding a
// phone, so the owner's approval is simulated, and the screen says so.

export const HONEST_LINE =
  "Local test chain (LiteSVM) running the real Leash program. Not devnet. The owner's approval is simulated.";

export type PitchDemoOptions = {
  write(line: string): void;
  color: boolean;
};

export type PitchDemoResult = {
  /** How each scene ended, in storyline order. */
  stops: string[];
  merchantPaid: bigint;
  attackerPaid: bigint;
  alerts: Alert[];
};

export async function runPitchDemo(options: PitchDemoOptions): Promise<PitchDemoResult> {
  const { write, color } = options;
  const paint = (style: Parameters<typeof styleText>[0], value: string) =>
    color ? styleText(style, value, { validateStream: false }) : value;
  const alerts: Alert[] = [];
  const printAlert = (alert: Alert) => {
    alerts.push(alert);
    const style = alert.severity === "critical" ? "red" : "magenta";
    for (const text of formatAlert(alert).trimEnd().split("\n")) {
      write(paint(style, `  alert: ${text}`));
    }
  };

  write(paint(["bold", "yellow"], HONEST_LINE));
  write("");
  const stack = await startStack({ write, color, onAlert: printAlert });
  try {
    const { bed, ui, runtime } = stack;
    ui.header("Leash demo agent", [
      "Research Assistant",
      "LiteSVM",
      "scripted",
      `agent key ${runtime.agent.address}`,
    ]);
    ui.agentStatus(await runtime.tools.status());

    const stops: string[] = [];
    for (const scene of STORYLINE) {
      const result = await stack.play(scene, async () => {
        // The request is on-chain: Sentinel alerts the owner, then the simulated owner approves.
        await stack.sync();
        await waitFor(
          () => alerts.some((a) => a.kind === "approval_requested"),
          "Sentinel's approval alert",
        );
        const request = await stack.approveOpenRequest();
        ui.notice(
          `Simulated owner: approved the request for ${formatUsdc(BigInt(request.amount))} USDC on-chain. ` +
            "On stage, the owner taps Approve in the web app's inbox.",
        );
      });
      stops.push(result.stop);
      if (result.stop !== "end_turn") break;
    }
    // The tripwire's alert comes from the stream; give it a moment to arrive.
    await waitFor(
      () => alerts.some((a) => a.kind === "tripwire_fired"),
      "Sentinel's tripwire alert",
    ).catch(() => {});

    const merchantPaid = await bed.balanceOf(bed.keys.merchant.address);
    const attackerPaid = await bed.balanceOf(bed.keys.attacker.address);
    write("");
    write(
      paint(
        "bold",
        `On-chain: the merchant received ${formatUsdc(merchantPaid)} USDC; the attacker received ${formatUsdc(attackerPaid)}.`,
      ),
    );
    return { stops, merchantPaid, attackerPaid, alerts };
  } finally {
    await stack.close();
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  runPitchDemo({
    write: (line) => process.stdout.write(`${line}\n`),
    color: process.stdout.isTTY === true && process.stdout.hasColors(),
  }).then(
    (result) => process.exit(result.stops.every((stop) => stop === "end_turn") ? 0 : 1),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
