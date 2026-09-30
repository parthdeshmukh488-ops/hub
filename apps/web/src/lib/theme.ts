export type Theme = "light" | "dark";

/** Where the choice is remembered (this browser only). */
export const THEME_STORAGE_KEY = "leash-theme";

/**
 * Runs in <head> before the first paint, so a saved dark choice never flashes white.
 * A constant: it reads only the browser's own storage.
 */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;
