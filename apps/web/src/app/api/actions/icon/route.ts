import { ACTION_HEADERS } from "../../../../server/actions/http.ts";
import { ICON_SVG } from "../../../../server/actions/icon.ts";

// The icon every Action's GET points to (the web app's purple "L").
export function GET(): Response {
  return new Response(ICON_SVG, {
    headers: {
      ...ACTION_HEADERS,
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
