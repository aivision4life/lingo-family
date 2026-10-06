// PIN hashing with PBKDF2 (Web Crypto, available in Workers and Node).
// The PIN only stops kids from switching into adult profiles; it is not real security
// (Cloudflare Access protects the app). Stored format: "pbkdf2-sha256$<iterations>$<salt>$<hash>".

// Workers limit PBKDF2 to 100k iterations.
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(pin, salt, ITERATIONS);
  return `pbkdf2-sha256$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !iterations || !salt || !hash) return false;
  const expected = fromB64(hash);
  const actual = await derive(pin, fromB64(salt), Number(iterations));
  // Constant-time comparison.
  let diff = expected.length ^ actual.length;
  for (let i = 0; i < expected.length; i++) diff |= expected[i]! ^ (actual[i] ?? 0);
  return diff === 0;
}
