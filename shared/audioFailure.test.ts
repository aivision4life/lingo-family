import { describe, expect, it } from "vitest";
import { classifyTtsError, worstFailure } from "./audioFailure";

describe("classifyTtsError", () => {
  // The real production error, verbatim from `wrangler tail` on 2026-11-07.
  it("calls a 401 a refusal, not a transient failure", () => {
    expect(classifyTtsError("Azure TTS HTTP 401: ")).toBe("provider_rejected");
    expect(classifyTtsError("Azure TTS HTTP 403: Forbidden")).toBe("provider_rejected");
  });

  it("calls a server error, a timeout or a network failure transient", () => {
    expect(classifyTtsError("Azure TTS HTTP 500: oops")).toBe("provider_error");
    expect(classifyTtsError("Azure TTS HTTP 429: too many")).toBe("provider_error");
    expect(classifyTtsError("Azure TTS request failed: TimeoutError")).toBe("provider_error");
    expect(classifyTtsError("Azure TTS returned empty audio")).toBe("provider_error");
  });

  // A status code has to be the status code, not any 401 inside the message text.
  it("does not read a number out of the middle of a word", () => {
    expect(classifyTtsError("Azure TTS HTTP 500: request a401b rejected")).toBe("provider_error");
  });
});

describe("worstFailure", () => {
  it("is null when nothing failed", () => {
    expect(worstFailure([])).toBeNull();
  });

  it("reports the one the next attempt will hit again", () => {
    // Quota beats a timeout: trying again tonight hits the quota, not the timeout.
    expect(worstFailure(["provider_error", "quota"])).toBe("quota");
    // A refused key beats the quota: no amount of waiting fixes it.
    expect(worstFailure(["quota", "provider_rejected"])).toBe("provider_rejected");
    expect(worstFailure(["provider_error", "quota", "not_configured"])).toBe("not_configured");
  });

  it("keeps a single reason as it is", () => {
    expect(worstFailure(["provider_error"])).toBe("provider_error");
  });
});
