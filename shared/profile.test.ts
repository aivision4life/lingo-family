import { describe, expect, it } from "vitest";
import { profileCreateSchema, profileUpdateSchema } from "./profile";

const valid = {
  name: "  Mẹ  ",
  avatar: "🐼",
  ui_lang: "vi",
  gloss_lang: "en",
  is_kid: false,
  daily_new_limit: 10,
  study_langs: ["en"],
};

describe("profile schemas", () => {
  it("trims the name", () => {
    expect(profileCreateSchema.parse(valid).name).toBe("Mẹ");
  });

  it.each([
    ["unknown avatar", { avatar: "X" }],
    ["limit above max", { daily_new_limit: 101 }],
    ["non-integer limit", { daily_new_limit: 1.5 }],
    ["duplicate study langs", { study_langs: ["en", "en"] }],
    ["unknown ui lang", { ui_lang: "fr" }],
    ["3-digit PIN", { pin: "123" }],
    ["PIN on a kid", { is_kid: true, pin: "1234" }],
  ])("rejects %s", (_, patch) => {
    expect(profileCreateSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it("allows partial updates and null PIN (= remove)", () => {
    expect(profileUpdateSchema.parse({ pin: null })).toEqual({ pin: null });
    expect(profileUpdateSchema.parse({})).toEqual({});
  });
});
