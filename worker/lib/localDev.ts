// Local-development switches (DEV_AUTH_BYPASS, DEV_TIME_TRAVEL) only count on a local host.
// The hostname comes from the parsed request URL, never from a client-controlled Host header.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocalHost(requestUrl: string): boolean {
  try {
    const host = new URL(requestUrl).hostname;
    return LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** True when `env[flag]` is "1" and the request really goes to a local host. */
export function localFlag(env: unknown, flag: string, requestUrl: string): boolean {
  return isLocalHost(requestUrl) && (env as Record<string, unknown> | null)?.[flag] === "1";
}
