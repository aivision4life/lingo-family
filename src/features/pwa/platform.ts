// Which install help to show (Settings → "Install app"). Pure functions, unit tested.
export type InstallMode =
  /** Running as an installed app already. */
  | "installed"
  /** The browser offered an install prompt (Android Chrome, desktop Chrome/Edge). */
  | "prompt"
  /** iPhone / iPad Safari: no prompt exists, show the Share → Add to Home Screen steps. */
  | "ios"
  /** Anything else: point to the browser menu. */
  | "other";

type NavLike = { userAgent: string; platform?: string; maxTouchPoints?: number };

/** iPhone, iPod, iPad — including iPadOS, whose Safari reports a Mac user agent. */
export function isIos(nav: NavLike): boolean {
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true;
  return nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1;
}

/** Display mode "standalone" (Android, desktop) or the iOS-only `navigator.standalone`. */
export function isStandalone(env: { displayModeStandalone: boolean; navigatorStandalone?: boolean }): boolean {
  return env.displayModeStandalone || env.navigatorStandalone === true;
}

export function installMode(a: { standalone: boolean; hasPrompt: boolean; ios: boolean }): InstallMode {
  if (a.standalone) return "installed";
  if (a.hasPrompt) return "prompt";
  if (a.ios) return "ios";
  return "other";
}
