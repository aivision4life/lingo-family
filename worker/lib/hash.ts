const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Hex SHA-256 of a UTF-8 string (Web Crypto). */
export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Hex SHA-1 of a UTF-8 string; used for content-addressed media keys (not for security). */
export async function sha1Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)));
}
