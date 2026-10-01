// The Actions icon: the web app's purple "L" (the header's logo, brand colour #6d28d9).

export const ICON_PATH = "/api/actions/icon";

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<rect width="256" height="256" rx="56" fill="#6d28d9"/>
<path d="M96 64h28v100h56v28H96z" fill="#f5f6f8"/>
</svg>`;

/** The icon's absolute URL: Blink clients fetch it from wherever they render the action. */
export function iconUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${ICON_PATH}`;
}
