import { describe, expect, it } from "vitest";
import { emptyTopikFormValues, toTopikInput, type TopikFormValues } from "./formValues";

const valid = (): TopikFormValues => ({
  ...emptyTopikFormValues("1~2"),
  exam: "Test/연습1",
  number: "1",
  options: [
    { text: "a", image_key: null },
    { text: "b", image_key: null },
    { text: "c", image_key: null },
    { text: "d", image_key: null },
  ],
  correct_option: 2,
});

describe("toTopikInput", () => {
  it("accepts a fully filled form", () => {
    expect(toTopikInput(valid())).toMatchObject({ exam: "Test/연습1", number: 1, correct_option: 2 });
  });

  it("rejects when no correct option is chosen yet (the empty/reset state)", () => {
    expect(toTopikInput({ ...valid(), correct_option: null })).toBeNull();
  });

  it("rejects a blank exam, block or non-positive number", () => {
    expect(toTopikInput({ ...valid(), exam: "  " })).toBeNull();
    expect(toTopikInput({ ...valid(), block: "" })).toBeNull();
    expect(toTopikInput({ ...valid(), number: "0" })).toBeNull();
    expect(toTopikInput({ ...valid(), number: "abc" })).toBeNull();
  });

  it("rejects an option with neither text nor image", () => {
    const v = valid();
    v.options[1] = { text: "", image_key: null };
    expect(toTopikInput(v)).toBeNull();
  });

  it("accepts an option with only an image (no text)", () => {
    const v = valid();
    v.options[1] = { text: "", image_key: "images/upload/abc.webp" };
    expect(toTopikInput(v)).not.toBeNull();
  });
});

describe("emptyTopikFormValues", () => {
  it("starts with correct_option unselected (never defaults to 1)", () => {
    expect(emptyTopikFormValues().correct_option).toBeNull();
  });

  it("keeps the given block", () => {
    expect(emptyTopikFormValues("9").block).toBe("9");
  });
});
