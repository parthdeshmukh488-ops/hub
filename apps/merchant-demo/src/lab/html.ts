/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

/**
 * Renders the small Markdown subset our content uses: headings, paragraphs, bullet lists,
 * bold and italics. Everything is escaped first, so no content can inject markup.
 */
export function markdownToHtml(markdown: string): string {
  const out: string[] = [];
  let list = false;
  const closeList = () => {
    if (list) out.push("</ul>");
    list = false;
  };
  for (const block of markdown.split(/\n{2,}/)) {
    for (const line of block.split("\n")) {
      const heading = /^(#{1,3}) (.*)$/.exec(line);
      const item = /^- (.*)$/.exec(line);
      if (heading) {
        closeList();
        const level = heading[1]?.length ?? 1;
        out.push(`<h${level}>${inline(heading[2] ?? "")}</h${level}>`);
      } else if (item) {
        if (!list) out.push("<ul>");
        list = true;
        out.push(`<li>${inline(item[1] ?? "")}</li>`);
      } else if (line.trim() !== "") {
        closeList();
        out.push(`<p>${inline(line)}</p>`);
      }
    }
    closeList();
  }
  return out.join("\n");
}

/** A minimal, readable page around `body` (already HTML). */
export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#0f1419;background:#fff}
h1{line-height:1.2}code{background:#eef0f4;padding:0 .25rem;border-radius:.25rem}
li{margin:.25rem 0}.muted{color:#535c6b}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
