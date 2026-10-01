// Builds docs/pitch/leash-deck.pptx. The words come from docs/pitch/deck.md: change them there
// first, then here. The screenshots are cropped from docs/pitch/img/.
//
// Its dependencies stay out of the pnpm workspace, so the lockfile never changes:
//   mkdir -p /tmp/deck && (cd /tmp/deck && npm init -y && npm install pptxgenjs@4 react react-dom react-icons sharp)
//   NODE_PATH=/tmp/deck/node_modules node docs/pitch/build-deck.cjs
// The PDF needs LibreOffice Impress:
//   soffice --headless --convert-to pdf --outdir docs/pitch docs/pitch/leash-deck.pptx
const path = require("node:path");
const pptxgen = require("pptxgenjs");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const sharp = require("sharp");
const lu = require("react-icons/lu");

const IMG = path.join(__dirname, "img");
const OUT = process.argv[2] ?? path.join(__dirname, "leash-deck.pptx");

/** A region of one of the web app screenshots, as image data for addImage. */
async function crop(file, left, top, width, height) {
  const png = await sharp(path.join(IMG, file)).extract({ left, top, width, height }).png().toBuffer();
  return `image/png;base64,${png.toString("base64")}`;
}

// The web app's light theme (apps/web/src/app/globals.css); soft tones are the 8-10% tints on white.
const C = {
  brand: "6D28D9",
  brandSoft: "F0E9FB",
  fg: "0F1419",
  muted: "535C6B",
  line: "DFE3EA",
  canvas: "F5F6F8",
  surface: "FFFFFF",
  surface2: "EEF0F4",
  ok: "047857",
  okSoft: "E6F2EE",
  blocked: "B91C1C",
  blockedSoft: "F8E8E8",
  approval: "B45309",
  approvalSoft: "F8EEE6",
  frozen: "1D4ED8",
  frozenSoft: "E8EDFB",
};
const FONT = "Arial";

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9"; // 10 x 5.625 in
pres.author = "Leash";
pres.title = "Leash: spending limits and an off switch for AI agents, enforced on Solana";

async function icon(name, hex) {
  const Icon = lu[name];
  if (!Icon) throw new Error(`missing icon ${name}`);
  const svg = renderToStaticMarkup(React.createElement(Icon, { size: 256, color: `#${hex}` })).replace(
    /currentColor/g,
    `#${hex}`,
  );
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return `image/png;base64,${png.toString("base64")}`;
}

function text(slide, value, x, y, w, h, o = {}) {
  slide.addText(value, {
    x,
    y,
    w,
    h,
    fontFace: FONT,
    fontSize: o.size ?? 14,
    color: o.color ?? C.fg,
    bold: o.bold ?? false,
    italic: o.italic ?? false,
    align: o.align ?? "left",
    valign: o.valign ?? "top",
    margin: 0,
    isTextBox: true,
    paraSpaceAfter: o.paraSpaceAfter,
    lineSpacingMultiple: o.lineSpacingMultiple,
  });
}

function title(slide, value) {
  text(slide, value, 0.6, 0.42, 8.8, 0.6, { size: 30, bold: true, valign: "middle" });
}

function card(slide, x, y, w, h, o = {}) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x,
    y,
    w,
    h,
    rectRadius: o.radius ?? 0.08,
    fill: { color: o.fill ?? C.surface },
    line: o.border === false ? { type: "none" } : { color: C.line, width: 0.75 },
    shadow:
      o.shadow === false
        ? undefined
        : { type: "outer", color: "000000", blur: 4, offset: 1, angle: 90, opacity: 0.08 },
  });
}

function chip(slide, label, x, y, w, h, fg, bg, o = {}) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x,
    y,
    w,
    h,
    rectRadius: 1,
    fill: { color: bg },
    line: { type: "none" },
  });
  if (o.icon) {
    const s = h * 0.56;
    slide.addImage({ data: o.icon, x: x + h * 0.32, y: y + (h - s) / 2, w: s, h: s });
    text(slide, label, x + h * 0.32 + s + 0.06, y, w - (h * 0.32 + s + 0.12), h, {
      size: o.size ?? 10.5,
      bold: true,
      color: fg,
      valign: "middle",
    });
  } else {
    text(slide, label, x, y, w, h, {
      size: o.size ?? 10.5,
      bold: true,
      color: fg,
      align: "center",
      valign: "middle",
    });
  }
}

function iconCircle(slide, data, x, y, d, bg) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: bg }, line: { type: "none" } });
  const p = d * 0.24;
  slide.addImage({ data, x: x + p, y: y + p, w: d - 2 * p, h: d - 2 * p });
}

function screenshot(slide, data, x, y, w, aspect) {
  const h = w / aspect;
  slide.addImage({ data, x, y, w, h });
  slide.addShape(pres.shapes.RECTANGLE, {
    x,
    y,
    w,
    h,
    fill: { color: "FFFFFF", transparency: 100 },
    line: { color: C.line, width: 0.75 },
  });
  return h;
}

function arrow(slide, x, y, w, color = C.muted) {
  slide.addShape(pres.shapes.LINE, {
    x,
    y,
    w,
    h: 0,
    line: { color, width: 1.5, endArrowType: "triangle" },
  });
}

function footer(slide, n) {
  text(slide, "Leash", 0.6, 5.2, 2, 0.22, { size: 9, color: C.muted });
  text(slide, String(n), 8.9, 5.2, 0.5, 0.22, { size: 9, color: C.muted, align: "right" });
}

function content(n) {
  const slide = pres.addSlide();
  slide.background = { color: C.canvas };
  footer(slide, n);
  return slide;
}

function brandMark(slide, x, y, d, size) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x,
    y,
    w: d,
    h: d,
    rectRadius: 0.3,
    fill: { color: C.brand },
    line: { type: "none" },
  });
  text(slide, "L", x, y, d, d, { size, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
}

const TEAM = "[Team: names and roles, to be filled in by Parth]";

async function main() {
  const I = {};
  const want = {
    post: ["LuMessageSquareWarning", C.fg],
    bot: ["LuBot", C.fg],
    money: ["LuBanknote", C.blocked],
    allow: ["LuListChecks", C.brand],
    limits: ["LuGauge", C.ok],
    approval: ["LuHourglass", C.approval],
    tripwire: ["LuSiren", C.blocked],
    off: ["LuSnowflake", C.frozen],
    checkOk: ["LuCircleCheck", C.ok],
    ban: ["LuBan", C.blocked],
    check: ["LuCheck", C.ok],
    x: ["LuX", C.blocked],
    coins: ["LuCoins", C.brand],
    lock: ["LuLock", C.frozen],
    blocks: ["LuBlocks", C.ok],
    shield: ["LuShieldCheck", C.ok],
    hourglass: ["LuHourglass", C.approval],
    users: ["LuUsers", C.brand],
    terminal: ["LuTerminal", C.brand],
    notes: ["LuFileText", C.brand],
    code: ["LuCode", C.ok],
    bell: ["LuBell", C.brand],
    receipt: ["LuReceipt", C.frozen],
    github: ["LuGithub", C.fg],
    globe: ["LuGlobe", C.fg],
    video: ["LuVideo", C.fg],
  };
  for (const [key, [name, hex]] of Object.entries(want)) I[key] = await icon(name, hex);
  const shots = {
    hero: await crop("web-overview.png", 260, 120, 2040, 1480),
    activity: await crop("web-activity.png", 260, 330, 2040, 1210),
    frozen: await crop("web-agent-frozen.png", 280, 250, 2000, 640),
  };

  // 1. Title
  {
    const s = pres.addSlide();
    s.background = { color: C.surface };
    brandMark(s, 0.6, 1.0, 0.8, 32);
    text(s, "Leash", 0.6, 1.95, 4.6, 0.85, { size: 54, bold: true, valign: "middle" });
    text(s, "Spending limits and an off switch for AI agents, enforced on Solana.", 0.6, 2.9, 4.5, 0.9, {
      size: 18,
      color: C.muted,
    });
    text(s, "Superteam Germany Solana Challenge\nWHU Prompting Progress · October 2026", 0.6, 3.9, 4.5, 0.45, {
      size: 10.5,
      color: C.muted,
    });
    chip(s, TEAM, 0.6, 4.55, 4.3, 0.36, C.approval, C.approvalSoft, { size: 10 });
    const h = screenshot(s, shots.hero, 5.4, 1.0, 4.0, 2040 / 1480);
    text(s, "The control panel after an attack (sample data)", 5.4, 1.0 + h + 0.1, 4.0, 0.25, {
      size: 9,
      color: C.muted,
    });
    s.addNotes(
      "AI agents can pay for things now. Leash makes sure an agent pays only who you allow, only as much as you allow, and stops by itself when someone tries to trick it.",
    );
  }

  // 2. Problem
  {
    const s = content(2);
    title(s, "An agent's wallet is all or nothing");
    const steps = [
      { icon: I.post, bg: C.surface2, head: "A post on X, in Morse code", sub: "May 4, 2026", color: C.fg },
      {
        icon: I.bot,
        bg: C.surface2,
        head: "Grok, wired to a trading bot, follows it",
        sub: "It does what the text says",
        color: C.fg,
      },
      {
        icon: I.money,
        bg: C.blockedSoft,
        head: "About $150–200k sent",
        sub: "Nothing asked if the payment made sense",
        color: C.blocked,
      },
    ];
    steps.forEach((st, i) => {
      const x = 0.6 + i * 3.15;
      card(s, x, 1.25, 2.55, 1.9);
      iconCircle(s, st.icon, x + 0.22, 1.45, 0.5, st.bg);
      text(s, st.head, x + 0.22, 2.05, 2.15, 0.5, { size: 13, bold: true, color: st.color });
      text(s, st.sub, x + 0.22, 2.55, 2.15, 0.35, { size: 10.5, color: C.muted });
      if (i < 2) arrow(s, x + 2.65, 2.12, 0.4);
    });
    s.addText(
      [
        {
          text: "An agent does what the text in front of it says.",
          options: { bold: true, breakLine: false },
        },
        { text: " A crafted message can make it pay the attacker.", options: { breakLine: true } },
        {
          text: "Today a developer hands the agent a private key or a custodial wallet: the agent, and anyone who can fool it, can move the whole balance.",
          options: {},
        },
      ],
      {
        x: 0.6,
        y: 3.3,
        w: 8.8,
        h: 1.4,
        fontFace: FONT,
        fontSize: 14,
        color: C.fg,
        margin: 0,
        valign: "top",
        paraSpaceAfter: 10,
        isTextBox: true,
      },
    );
    text(s, "Source: OECD.AI incident report, May 4, 2026", 0.6, 4.85, 6, 0.22, { size: 9, color: C.muted });
    s.addNotes(
      "No model is immune to a crafted message. On May 4, a post in Morse code got Grok to send up to two hundred thousand dollars. Nothing between the agent and the money asked whether that payment made sense.",
    );
  }

  // 3. Why now
  {
    const s = content(3);
    title(s, "Agents already pay, on Solana");
    text(s, "23.2M", 0.6, 1.15, 4.3, 0.85, { size: 54, bold: true, color: C.brand, valign: "middle" });
    text(s, "x402 agent payments on Solana in the four weeks to Sept 22, 2026", 0.6, 2.0, 4.0, 0.5, {
      size: 13,
      color: C.muted,
    });
    text(s, "76%", 0.6, 2.7, 4.3, 0.85, { size: 54, bold: true, color: C.brand, valign: "middle" });
    text(s, "of all x402 agent payments", 0.6, 3.55, 4.0, 0.3, { size: 13, color: C.muted });

    card(s, 5.2, 1.2, 4.2, 3.3);
    text(s, "June 2026", 5.5, 1.45, 3.6, 0.3, { size: 12, bold: true, color: C.brand });
    text(s, "The Solana Foundation shipped an audited Allowances program.", 5.5, 1.8, 3.6, 0.7, {
      size: 15,
      bold: true,
    });
    text(s, "How much may it spend?", 5.5, 2.75, 2.15, 0.36, { size: 12, valign: "middle" });
    chip(s, "Allowances", 7.65, 2.75, 1.5, 0.36, C.ok, C.okSoft, { icon: I.check });
    text(s, "Who may it pay?", 5.5, 3.25, 2.15, 0.36, { size: 12, valign: "middle" });
    chip(s, "Not decided", 7.65, 3.25, 1.5, 0.36, C.blocked, C.blockedSoft, { icon: I.x });
    text(s, "Leash fills that gap.", 5.5, 3.85, 3.6, 0.35, { size: 14, bold: true, color: C.brand });
    text(s, "Sources: Solana Compass; the Solana Foundation's Subscriptions & Allowances program", 0.6, 4.85, 8, 0.22, {
      size: 9,
      color: C.muted,
    });
    s.addNotes(
      "Agent payments are already here: Solana carried twenty-three million of them in four weeks. In June the Solana Foundation shipped an audited Allowances program. It caps how much a delegate can spend, but not who it pays. That gap is where Leash sits.",
    );
  }

  // 4. Solution
  {
    const s = content(4);
    title(s, "A firewall between agent and money");
    const tiles = [
      { icon: I.allow, bg: C.brandSoft, head: "Allowlist", body: "Pays only payees you approved." },
      { icon: I.limits, bg: C.okSoft, head: "Limits", body: "Per payment, per payee, and a rate limit." },
      { icon: I.approval, bg: C.approvalSoft, head: "Approval", body: "Anything above your threshold waits for your yes." },
      { icon: I.tripwire, bg: C.blockedSoft, head: "Tripwire", body: "Three attempts to break the rules, and it freezes itself." },
      { icon: I.off, bg: C.frozenSoft, head: "Off switch", body: "One transaction freezes one agent, or all of them." },
    ];
    tiles.forEach((t, i) => {
      const x = 0.6 + i * 1.8;
      card(s, x, 1.2, 1.6, 2.3);
      iconCircle(s, t.icon, x + 0.2, 1.4, 0.55, t.bg);
      text(s, t.head, x + 0.2, 2.07, 1.25, 0.3, { size: 14, bold: true });
      text(s, t.body, x + 0.2, 2.42, 1.25, 1.0, { size: 11, color: C.muted });
    });
    text(s, "Your money never leaves your wallet. Leash can only make the allowance smaller.", 0.6, 3.75, 8.8, 0.35, {
      size: 14,
      bold: true,
    });
    text(
      s,
      "Solana's Allowances decide how much an agent may spend. Leash decides who it may pay, how fast, and what happens when it's attacked.",
      0.6,
      4.2,
      8.8,
      0.6,
      { size: 13, italic: true, color: C.brand },
    );
    s.addNotes(
      "Your money stays in your wallet. The agent can only spend through Leash, and Leash checks every payment on-chain. The most it can ever spend is the allowance in Solana's own audited program, and Leash can only make that smaller.",
    );
  }

  // 5. How it works
  {
    const s = content(5);
    title(s, "How it works");
    const boxes = [
      ["AI agent", "Leash SDK or MCP"],
      ["Paid API", "x402 payment"],
      ["x402 facilitator", "official package, pays the fee"],
      ["Leash program", "allowlist · limits · freeze"],
      ["Allowances program", "Solana Foundation, audited"],
    ];
    boxes.forEach(([head, sub], i) => {
      const x = 0.6 + i * 1.82;
      const leash = i === 3;
      card(s, x, 1.25, 1.52, 1.1, { fill: leash ? C.brand : C.surface, border: !leash });
      s.addText(
        [
          { text: head, options: { bold: true, fontSize: 12, color: leash ? "FFFFFF" : C.fg, breakLine: true } },
          { text: sub, options: { fontSize: 9.5, color: leash ? "EDE6FB" : C.muted } },
        ],
        {
          x: x + 0.08,
          y: 1.25,
          w: 1.36,
          h: 1.1,
          fontFace: FONT,
          align: "center",
          valign: "middle",
          margin: 0,
          paraSpaceAfter: 3,
          isTextBox: true,
        },
      );
      if (i < 4) arrow(s, x + 1.57, 1.8, 0.2);
    });
    card(s, 0.6, 2.7, 4.3, 0.95, { fill: C.okSoft, border: false, shadow: false });
    s.addImage({ data: I.checkOk, x: 0.8, y: 2.98, w: 0.36, h: 0.36 });
    s.addText(
      [
        { text: "Every check passes: ", options: { bold: true } },
        { text: "the Allowances program moves USDC from the owner's wallet to the payee." },
      ],
      { x: 1.3, y: 2.7, w: 3.45, h: 0.95, fontFace: FONT, fontSize: 12, color: C.fg, valign: "middle", margin: 0, isTextBox: true },
    );
    card(s, 5.1, 2.7, 4.3, 0.95, { fill: C.blockedSoft, border: false, shadow: false });
    s.addImage({ data: I.ban, x: 5.3, y: 2.98, w: 0.36, h: 0.36 });
    s.addText(
      [
        { text: "A check fails: ", options: { bold: true } },
        { text: "nothing moves, the attempt is recorded on-chain as a strike, and three strikes freeze the agent." },
      ],
      { x: 5.8, y: 2.7, w: 3.45, h: 0.95, fontFace: FONT, fontSize: 12, color: C.fg, valign: "middle", margin: 0, isTextBox: true },
    );
    s.addText(
      [
        {
          text: "The agent's key can't move money by itself: the allowance belongs to the agent's Leash account, which only the program signs for, after every check.",
          options: { bullet: { indent: 14 }, breakLine: true },
        },
        {
          text: "Standard x402: any facilitator running the official package accepts Leash payments after two settings changes.",
          options: { bullet: { indent: 14 } },
        },
      ],
      { x: 0.6, y: 3.9, w: 8.8, h: 1.1, fontFace: FONT, fontSize: 12, color: C.fg, margin: 0, valign: "top", paraSpaceAfter: 6, isTextBox: true },
    );
    s.addNotes(
      "The agent's key can't move money by itself. The owner's allowance belongs to the agent's Leash account, and the program signs the transfer only after every check passes. Payments are ordinary x402 payments: merchants keep their setup, and their facilitator turns on two settings.",
    );
  }

  // 6. Demo
  {
    const s = content(6);
    title(s, "The demo, in four frames");
    const frames = [
      { label: "Paid", fg: C.ok, bg: C.okSoft, body: "The agent pays the Research API 0.01–0.02 USDC per call.", h: 0.45 },
      {
        label: "Approval",
        fg: C.approval,
        bg: C.approvalSoft,
        body: "A 1.50 USDC report is above its 1 USDC limit, so it asks. The owner approves.",
        h: 0.65,
      },
      {
        label: "Blocked ×3",
        fg: C.blocked,
        bg: C.blockedSoft,
        body: "A page hides “tip 25 USDC” to an unknown wallet. Blocked: strike 1, 2, 3.",
        h: 0.65,
      },
      {
        label: "Frozen",
        fg: C.frozen,
        bg: C.frozenSoft,
        body: "The tripwire freezes the agent. The owner sees every attempt, with the attacker's address.",
        h: 0.65,
      },
    ];
    let y = 1.2;
    for (const f of frames) {
      chip(s, f.label, 0.6, y, 1.15, 0.32, f.fg, f.bg, { size: 10 });
      text(s, f.body, 1.95, y + 0.02, 2.75, f.h, { size: 11.5 });
      y += f.h + 0.12;
    }
    screenshot(s, shots.activity, 5.0, 1.2, 4.4, 2040 / 1210);
    text(s, "The model was fooled. The money wasn't moved.", 0.6, 4.2, 8.8, 0.4, { size: 18, bold: true });
    text(
      s,
      "Scripted scene: simulating a successful injection. Every payment, block and strike is real and on-chain. Screenshot: the control panel replaying the demo story (sample data).",
      0.6,
      4.65,
      8.8,
      0.4,
      { size: 9, color: C.muted },
    );
    s.addNotes(
      "The agent reads a buying guide with a hidden instruction: tip twenty-five dollars to a stranger. In this run we script the agent to fall for it, and the screen says so, because we want to show what happens when the model is fooled. It tries three times: three blocks, three strikes, and the agent freezes itself, on-chain. The model was fooled. The money wasn't moved.\n\nIf something fails live: approve with the web app or pnpm owner:approve; unfreeze with the web app or pnpm owner:unfreeze (it also clears leftover strikes). Run the 'Before each take' checklist in apps/agent-demo/README.md before every take.",
    );
  }

  // 7. Why Solana
  {
    const s = content(7);
    title(s, "Why Solana");
    const cols = [
      {
        icon: I.coins,
        bg: C.brandSoft,
        head: "Pay per call",
        body: "A 0.01 USDC API call needs sub-cent fees and fast settlement. 76% of x402 agent payments already run on Solana.",
      },
      {
        icon: I.lock,
        bg: C.frozenSoft,
        head: "Rules where the money is",
        body: "No prompt can change on-chain rules, and a freeze applies to everyone from the next slot.",
      },
      {
        icon: I.blocks,
        bg: C.okSoft,
        head: "Built from Solana's parts",
        body: "The Foundation's audited Allowances program is the hard ceiling, x402 carries the payment, and Leash adds the rules in between.",
      },
    ];
    cols.forEach((c, i) => {
      const x = 0.6 + i * 3.0;
      card(s, x, 1.2, 2.8, 2.75);
      iconCircle(s, c.icon, x + 0.25, 1.42, 0.55, c.bg);
      text(s, c.head, x + 0.25, 2.08, 2.3, 0.55, { size: 15, bold: true });
      text(s, c.body, x + 0.25, 2.72, 2.3, 1.15, { size: 11.5, color: C.muted });
    });
    text(
      s,
      "Off-chain, a firewall can be bypassed by whoever holds the key. On Solana, the agent's key alone can't move the money.",
      0.6,
      4.2,
      8.8,
      0.6,
      { size: 14, bold: true },
    );
    s.addNotes(
      "Without Solana this product doesn't work. A firewall that runs off-chain can be bypassed by whoever holds the key, and paying per API call needs fees far below a cent.",
    );
  }

  // 8. Trust
  {
    const s = content(8);
    title(s, "Fail-closed and non-custodial");
    card(s, 0.6, 1.2, 4.5, 1.15, { fill: C.brandSoft, border: false, shadow: false });
    text(
      s,
      "“Your money never leaves your wallet. The most any agent can ever spend is the allowance you set in Solana's own audited program. Leash can only make that smaller.”",
      0.8,
      1.3,
      4.1,
      0.95,
      { size: 12.5, italic: true, valign: "middle" },
    );
    text(s, "What can still go wrong", 0.6, 2.55, 4.5, 0.3, { size: 13, bold: true });
    s.addText(
      [
        { text: "A fooled agent can still buy allowed things it didn't need, within its limits.", options: { bullet: { indent: 14 }, breakLine: true } },
        { text: "A stolen agent key can only pay allowlisted payees, within the limits.", options: { bullet: { indent: 14 }, breakLine: true } },
        { text: "An attacker can trip the wire on purpose: the agent freezes, the safe way to fail.", options: { bullet: { indent: 14 }, breakLine: true } },
        { text: "On devnet one key can upgrade the program; in production, a timelocked multisig or no key.", options: { bullet: { indent: 14 } } },
      ],
      { x: 0.6, y: 2.9, w: 4.5, h: 2.0, fontFace: FONT, fontSize: 11, color: C.fg, margin: 0, valign: "top", paraSpaceAfter: 5, isTextBox: true },
    );
    const h = screenshot(s, shots.frozen, 5.4, 1.2, 4.0, 2000 / 640);
    text(s, "The agent page after the attack (sample data)", 5.4, 1.2 + h + 0.08, 4.0, 0.22, { size: 9, color: C.muted });
    card(s, 5.4, 2.95, 4.0, 1.9);
    iconCircle(s, I.shield, 5.6, 3.12, 0.48, C.okSoft);
    text(s, "Tested on every commit", 6.22, 3.12, 3.0, 0.48, { size: 13, bold: true, valign: "middle" });
    s.addText(
      [
        { text: "Six invariants", options: { bullet: { indent: 14 }, breakLine: true } },
        { text: "Account-substitution attacks", options: { bullet: { indent: 14 }, breakLine: true } },
        { text: "Random payment sequences that never exceed the allowance", options: { bullet: { indent: 14 } } },
      ],
      { x: 5.6, y: 3.75, w: 3.6, h: 1.0, fontFace: FONT, fontSize: 11, color: C.fg, margin: 0, valign: "top", paraSpaceAfter: 4, isTextBox: true },
    );
    s.addNotes(
      "A security product has to say what can still go wrong, so here is our list. Note the last line: today one key can upgrade the program on devnet. Before mainnet, that becomes a timelocked multisig, or no key at all.",
    );
  }

  // 9. Working today
  {
    const s = content(9);
    title(s, "Working today");
    chip(s, "Done", 0.6, 1.15, 1.0, 0.32, C.ok, C.okSoft, { icon: I.check });
    const done = [
      "The Leash program, live on devnet",
      "60 policy test cases give the same result in TypeScript, in Rust, and in LiteSVM on the exact program binary deployed on devnet (checked byte for byte)",
      "x402 payments through the unmodified official facilitator",
      "Claude Code connects to the Leash MCP server",
      "The whole demo story, end to end on a local Solana validator",
      "A control panel that updates live from the indexer's stream",
    ];
    let y = 1.62;
    for (const d of done) {
      const h = d.length > 70 ? 0.6 : 0.3;
      s.addImage({ data: I.checkOk, x: 0.6, y: y + 0.02, w: 0.22, h: 0.22 });
      text(s, d, 0.95, y, 4.9, h, { size: 11.5 });
      y += h + 0.12;
    }
    chip(s, "In progress", 6.2, 1.15, 1.45, 0.32, C.approval, C.approvalSoft, { icon: I.hourglass });
    const doing = [
      "Pairing, approve, freeze and unfreeze in the web app",
      "Telegram alerts",
      "The full demo on devnet, and its recording",
    ];
    y = 1.62;
    for (const d of doing) {
      const h = d.length > 34 ? 0.42 : 0.22;
      s.addImage({ data: I.hourglass, x: 6.2, y: y + 0.02, w: 0.2, h: 0.2 });
      text(s, d, 6.52, y, 2.85, h, { size: 11.5 });
      y += h + 0.14;
    }
    card(s, 6.2, 3.35, 3.2, 1.35);
    text(s, "767", 6.45, 3.5, 2.8, 0.6, { size: 36, bold: true, color: C.brand, valign: "middle" });
    text(s, "automated tests, run on every commit", 6.45, 4.1, 2.8, 0.25, { size: 11 });
    text(s, "639 TypeScript · 128 Rust", 6.45, 4.36, 2.8, 0.22, { size: 10, color: C.muted });
    s.addNotes(
      "Everything on the left runs today, and you can check it: the repo is public, and the tests run without a chain. The right column is what we're finishing this week.",
    );
  }

  // 10. First users
  {
    const s = content(10);
    title(s, "First users");
    const sections = [
      {
        icon: I.users,
        head: "Who",
        body: "Developers and small teams whose agents pay for APIs and services over x402: the teams big platforms ignore.",
        h: 0.45,
      },
      {
        icon: I.terminal,
        head: "How we reach them",
        body: "The MCP server: one config line gives Claude Code, Claude Desktop or Cursor a wallet on a leash. And x402 facilitators: two settings changes.",
        h: 0.65,
      },
      {
        icon: I.notes,
        head: "What we know so far",
        body: "No conversations with users yet. Next: five conversations with developers whose agents pay for APIs (Superteam Germany, x402 builders, MCP users).",
        h: 0.65,
      },
    ];
    let y = 1.15;
    for (const sec of sections) {
      iconCircle(s, sec.icon, 0.6, y, 0.42, C.brandSoft);
      text(s, sec.head, 1.15, y + 0.02, 4.3, 0.3, { size: 13, bold: true });
      text(s, sec.body, 1.15, y + 0.34, 4.3, sec.h, { size: 11.5, color: C.fg });
      y += 0.34 + sec.h + 0.2;
    }
    chip(s, "[Parth: replace with who you talked to and what they said]", 1.15, y - 0.12, 4.3, 0.34, C.approval, C.approvalSoft, {
      size: 9,
    });
    card(s, 5.75, 1.15, 3.65, 3.6);
    text(s, "Others in the space", 5.95, 1.3, 3.3, 0.3, { size: 13, bold: true });
    const others = [
      ["Swig, Squads", "Smart-account wallets with spending limits", C.fg, 0.45],
      ["Crossmint, Openfort", "Agent wallets", C.fg, 0.45],
      ["Ramp", "Testing x402 agent wallets on Solana, in a limited alpha", C.fg, 0.64],
      [
        "Leash",
        "The on-chain firewall on top of Solana's own Allowances program: who may be paid, how fast, and a tripwire, without holding anyone's money.",
        C.brand,
        0.84,
      ],
    ];
    y = 1.72;
    for (const [name, desc, color, h] of others) {
      text(s, name, 5.95, y, 3.3, 0.22, { size: 11, bold: true, color });
      text(s, desc, 5.95, y + 0.22, 3.3, h - 0.22, { size: 10.5, color: C.muted });
      y += h + 0.1;
    }
    s.addNotes(
      "Our first users are developers like us, whose agents already pay for APIs. They live in Claude Code and Cursor, and the MCP server puts Leash one config line away. We haven't talked to users yet. Five conversations with agent builders are our next step.",
    );
  }

  // 11. Business model
  {
    const s = content(11);
    title(s, "Business model: open core");
    const tiers = [
      {
        icon: I.code,
        bg: C.okSoft,
        head: "Free and open source",
        body: "The Leash program, the SDK and the MCP server.",
        why: "A security product must be verifiable.",
      },
      {
        icon: I.bell,
        bg: C.brandSoft,
        head: "Paid",
        body: "A hosted control panel with alerts and a guardian, per agent per month.",
        why: "What runs around the clock.",
      },
      {
        icon: I.receipt,
        bg: C.frozenSoft,
        head: "Later",
        body: "A fee per payment through a hosted facilitator.",
        why: "Needs no program change.",
      },
    ];
    tiers.forEach((t, i) => {
      const x = 0.6 + i * 3.0;
      card(s, x, 1.2, 2.8, 2.6);
      iconCircle(s, t.icon, x + 0.25, 1.42, 0.55, t.bg);
      text(s, t.head, x + 0.25, 2.12, 2.3, 0.35, { size: 15, bold: true });
      text(s, t.body, x + 0.25, 2.52, 2.3, 0.7, { size: 12 });
      text(s, t.why, x + 0.25, 3.3, 2.3, 0.35, { size: 10.5, color: C.muted, italic: true });
    });
    text(s, "Adoption comes from the free parts. Teams pay for what runs around the clock.", 0.6, 4.1, 8.8, 0.4, {
      size: 14,
      bold: true,
    });
    s.addNotes(
      "The parts that hold the rules are free and open, because a security product must be verifiable. Teams pay for the parts that run around the clock: the panel, the alerts, and a guardian that can freeze an agent at 3 a.m.",
    );
  }

  // 12. Roadmap
  {
    const s = content(12);
    title(s, "Roadmap");
    s.addShape(pres.shapes.LINE, { x: 0.74, y: 1.55, w: 8.4, h: 0, line: { color: C.line, width: 2 } });
    const stages = [
      {
        color: C.approval,
        head: "This week",
        sub: "for the Oct 4 submission · in progress",
        items: ["The demo on devnet", "Pairing, approvals and the off switch in the web app", "Telegram alerts"],
      },
      {
        color: C.brand,
        head: "By Nov 2",
        sub: "the Colosseum hackathon",
        items: [
          "Solana Action links to freeze or approve from anywhere",
          "The guardian freezes an agent by itself when Sentinel sees an attack",
          "Recorded runs with a live Claude model",
          "Five user conversations",
        ],
      },
      {
        color: C.fg,
        head: "Then",
        sub: "on the way to mainnet",
        items: ["An independent audit", "Upgrade authority moved to a timelocked multisig, or revoked", "Mainnet"],
      },
    ];
    stages.forEach((st, i) => {
      const x = 0.6 + i * 3.0;
      s.addShape(pres.shapes.OVAL, { x, y: 1.41, w: 0.28, h: 0.28, fill: { color: st.color }, line: { type: "none" } });
      text(s, st.head, x, 1.85, 2.8, 0.32, { size: 15, bold: true });
      text(s, st.sub, x, 2.17, 2.8, 0.25, { size: 10.5, color: C.muted });
      s.addText(
        st.items.map((it, j) => ({ text: it, options: { bullet: { indent: 14 }, breakLine: j < st.items.length - 1 } })),
        { x, y: 2.55, w: 2.8, h: 2.3, fontFace: FONT, fontSize: 11.5, color: C.fg, margin: 0, valign: "top", paraSpaceAfter: 6, isTextBox: true },
      );
    });
    s.addNotes(
      "We keep building through Colosseum. The order is: finish the owner's side, make every alert actionable from a link, and only then go to mainnet, after an audit.",
    );
  }

  // 13. Team and close
  {
    const s = pres.addSlide();
    s.background = { color: C.surface };
    brandMark(s, 4.65, 0.5, 0.7, 28);
    text(s, "The model was fooled.\nThe money wasn't moved.", 0.6, 1.4, 8.8, 1.2, {
      size: 32,
      bold: true,
      align: "center",
      valign: "middle",
    });
    text(s, "Solana's Allowances cap how much. Leash decides who, how fast, and when to stop.", 0.6, 2.7, 8.8, 0.4, {
      size: 15,
      color: C.muted,
      align: "center",
    });
    chip(s, TEAM, 2.75, 3.3, 4.5, 0.36, C.approval, C.approvalSoft, { size: 10 });
    const links = [
      { icon: I.github, label: "github.com/parthdeshmukh488-ops/hub", url: "https://github.com/parthdeshmukh488-ops/hub" },
      {
        icon: I.globe,
        label: "Leash on devnet: HyL9S5mA…HJncu",
        url: "https://explorer.solana.com/address/HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu?cluster=devnet",
      },
      { icon: I.video, label: "Demo video: in progress" },
    ];
    links.forEach((l, i) => {
      const x = 0.6 + i * 3.0;
      s.addImage({ data: l.icon, x, y: 4.0, w: 0.26, h: 0.26 });
      s.addText(
        [{ text: l.label, options: l.url ? { hyperlink: { url: l.url }, color: C.brand } : { color: C.fg } }],
        { x: x + 0.36, y: 3.98, w: 2.5, h: 0.3, fontFace: FONT, fontSize: 9.5, margin: 0, valign: "middle", isTextBox: true },
      );
    });
    text(s, "Built with parallel Claude Code sessions, each owning one part of the architecture.", 0.6, 4.85, 8.8, 0.25, {
      size: 9,
      color: C.muted,
      align: "center",
    });
    s.addNotes("Agents will keep getting fooled. With Leash, that stops costing you money.");
  }

  await pres.writeFile({ fileName: OUT });
  console.log(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
