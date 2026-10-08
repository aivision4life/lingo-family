import { describe, expect, it } from "vitest";
import { WORD_ERRORS } from "@shared/word";
import { ApiError } from "@/lib/api";
import { isRetryableAiError } from "./format";

describe("isRetryableAiError", () => {
  it("offers Try again for busy / invalid AI answers, server errors and network failures", () => {
    expect(isRetryableAiError(new ApiError(503, WORD_ERRORS.aiUnavailable))).toBe(true);
    expect(isRetryableAiError(new ApiError(502, WORD_ERRORS.aiInvalidOutput))).toBe(true);
    expect(isRetryableAiError(new ApiError(500, "unknown"))).toBe(true);
    expect(isRetryableAiError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("not for quota, refused requests, missing config, duplicates or no error", () => {
    expect(isRetryableAiError(new ApiError(429, WORD_ERRORS.quotaExceeded))).toBe(false);
    expect(isRetryableAiError(new ApiError(502, WORD_ERRORS.aiRejected))).toBe(false);
    expect(isRetryableAiError(new ApiError(503, WORD_ERRORS.aiNotConfigured))).toBe(false);
    expect(isRetryableAiError(new ApiError(409, WORD_ERRORS.duplicate))).toBe(false);
    expect(isRetryableAiError(null)).toBe(false);
  });
});
