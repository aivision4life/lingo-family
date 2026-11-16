import { describe, expect, it } from "vitest";
import { PRON_ERRORS } from "@shared/pron";
import { ApiError } from "@/lib/api";
import { pronFailure } from "./pronFailure";

describe("pronFailure (M3.2)", () => {
  it("keeps the cases the learner can act on apart", () => {
    expect(pronFailure(new ApiError(429, PRON_ERRORS.quotaExceeded))).toBe("quota");
    expect(pronFailure(new ApiError(422, PRON_ERRORS.noResult))).toBe("noSpeech");
    expect(pronFailure(new ApiError(400, PRON_ERRORS.invalidAudio))).toBe("badAudio");
    expect(pronFailure(new ApiError(503, PRON_ERRORS.unavailable))).toBe("unavailable");
  });

  it("reads a refused microphone off the DOMException name", () => {
    expect(pronFailure(new DOMException("no", "NotAllowedError"))).toBe("micDenied");
    expect(pronFailure(new DOMException("no", "SecurityError"))).toBe("micDenied");
    expect(pronFailure(new DOMException("none", "NotFoundError"))).toBe("micMissing");
  });

  it("falls back to one generic case, Azure's own failure included", () => {
    expect(pronFailure(new ApiError(502, PRON_ERRORS.failed))).toBe("network");
    expect(pronFailure(new ApiError(500, "unknown"))).toBe("network");
    expect(pronFailure(new TypeError("Failed to fetch"))).toBe("network");
    expect(pronFailure("nothing useful")).toBe("network");
  });
});
