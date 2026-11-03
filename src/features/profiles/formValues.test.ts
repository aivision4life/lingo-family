import { describe, expect, it } from "vitest";
import type { Profile } from "@shared/profile";
import { emptyFormValues, formValuesFromProfile, toCreateInput, toUpdateInput, type FormValues } from "./formValues";

const emptyProfile: Profile = {
  id: "p1",
  name: "Bố",
  avatar: "🐻",
  avatar_photo: null,
  ui_lang: "vi",
  gloss_lang: "vi",
  is_kid: false,
  daily_new_limit: 10,
  study_langs: ["ko"],
  card_types: ["recognition"],
  own_words_only: false,
  session_size: 10,
  has_pin: false,
  created_at: 0,
};

const filled: FormValues = { ...emptyFormValues("vi"), name: "Bố", study_langs: ["ko"] };

describe("profile form values", () => {
  it("converts a valid form into create input", () => {
    const { data } = toCreateInput({ ...filled, pin: "1234" });
    expect(data).toMatchObject({ name: "Bố", daily_new_limit: 10, pin: "1234" });
  });

  it("reports field errors", () => {
    const { errors } = toCreateInput({ ...filled, name: "", study_langs: [], daily_new_limit: "", pin: "12" });
    expect(errors).toEqual({ name: true, study_langs: true, daily_new_limit: true, pin: true });
  });

  // M6.6: a new profile practises all three card types, and switching every one off is refused
  // (the review session would just be empty).
  it("starts with all review card types and rejects an empty selection", () => {
    expect(emptyFormValues("vi").card_types).toEqual(["recognition", "picture", "listening"]);
    expect(toCreateInput({ ...filled, card_types: [] }).errors).toEqual({ card_types: true });
    expect(toUpdateInput({ ...filled, card_types: ["listening"] }).data?.card_types).toEqual(["listening"]);
  });

  // M6.13: how many questions a TOPIK session asks, per profile.
  it("starts at 10 questions a session and carries the chosen size through", () => {
    expect(emptyFormValues("vi").session_size).toBe(10);
    expect(toCreateInput({ ...filled, session_size: 5 }).data?.session_size).toBe(5);
    expect(toUpdateInput({ ...filled, session_size: 20 }).data?.session_size).toBe(20);
  });

  it("falls back to 10 for a profile saved with a size the form does not offer", () => {
    // A row written before the setting existed, or by a build that offered other numbers: the
    // form must open on a real choice rather than on a button nothing matches.
    const stored = { session_size: 7 } as Profile;
    expect(formValuesFromProfile({ ...emptyProfile, ...stored }).session_size).toBe(10);
  });

  it("drops the PIN for kids", () => {
    expect(toCreateInput({ ...filled, is_kid: true, pin: "1234" }).data?.pin).toBeUndefined();
  });

  it("maps PIN edits to keep / set / remove", () => {
    // undefined is dropped by JSON.stringify, so the server keeps the current PIN.
    expect(toUpdateInput(filled).data?.pin).toBeUndefined();
    expect(toUpdateInput({ ...filled, pin: "9999" }).data?.pin).toBe("9999");
    expect(toUpdateInput({ ...filled, pin: "9999", removePin: true }).data?.pin).toBeNull();
  });
});
