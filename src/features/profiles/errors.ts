import type { TFunction } from "i18next";
import { PROFILE_ERRORS } from "@shared/profile";
import { ApiError } from "@/lib/api";

/** Translated message for a failed profile mutation, or null if there is no error. */
export function profileErrorMessage(error: unknown, t: TFunction): string | null {
  if (!error) return null;
  if (error instanceof ApiError && error.code === PROFILE_ERRORS.lastAdult) return t("profiles.errors.last_adult");
  return t("profiles.errors.generic");
}
