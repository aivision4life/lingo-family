import { describe, expect, it } from "vitest";
import { hashPin, verifyPin } from "./pin";

describe("PIN hashing", () => {
  it("verifies the right PIN and rejects a wrong one", async () => {
    const stored = await hashPin("1234");
    expect(stored).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(await verifyPin("1234", stored)).toBe(true);
    expect(await verifyPin("1235", stored)).toBe(false);
  });

  it("uses a random salt", async () => {
    expect(await hashPin("1234")).not.toBe(await hashPin("1234"));
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPin("1234", "plain-text")).toBe(false);
  });
});
