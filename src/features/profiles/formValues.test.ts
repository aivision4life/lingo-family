import { describe, expect, it } from "vitest";
import { emptyFormValues, toCreateInput, toUpdateInput, type FormValues } from "./formValues";

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
