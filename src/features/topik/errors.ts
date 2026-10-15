import type { TFunction } from "i18next";
import { TOPIK_ERRORS } from "@shared/topik";
import { ApiError } from "@/lib/api";

/** Translated message for a failed TOPIK question mutation, or null if there is no error. */
export function topikErrorMessage(error: unknown, t: TFunction): string | null {
  if (!error) return null;
  if (error instanceof ApiError && error.code === TOPIK_ERRORS.duplicate) return t("topik.manage.form.duplicate");
  return t("topik.manage.form.generic");
}
