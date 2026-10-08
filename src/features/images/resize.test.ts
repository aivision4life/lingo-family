import { describe, expect, it } from "vitest";
import { fitWithin } from "./resize";

describe("fitWithin (upload resize)", () => {
  it("shrinks the longer side to 512 px and keeps the aspect ratio", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 512, height: 384 });
    expect(fitWithin(1000, 2000)).toEqual({ width: 256, height: 512 });
    expect(fitWithin(5000, 10)).toEqual({ width: 512, height: 1 });
  });

  it("never enlarges small pictures", () => {
    expect(fitWithin(300, 200)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(512, 512)).toEqual({ width: 512, height: 512 });
  });
});
