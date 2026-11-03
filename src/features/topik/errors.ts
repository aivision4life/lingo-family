import type { TFunction } from "i18next";
import { z } from "zod";
import { TOPIK_ERRORS } from "@shared/topik";
import { ApiError } from "@/lib/api";

/** The position a mixed draw ran out at, when the server sent one. */
const bankShortBody = z.object({ missing_position: z.number().int().positive() });

/** Translated message for a failed TOPIK question mutation, or null if there is no error. */
export function topikErrorMessage(error: unknown, t: TFunction): string | null {
  if (!error) return null;
  if (error instanceof ApiError && error.code === TOPIK_ERRORS.duplicate) return t("topik.manage.form.duplicate");
  return t("topik.manage.form.generic");
}

/**
 * Why a mock test would not start, in words the learner can act on.
 *
 * "Không mở được bài thi. Thử lại." told nobody anything, and the one person who sees it is on a
 * phone with no developer tools. A server fault keeps its status code in the text on purpose: it
 * is the only thing that can be read back to someone who can look at the logs.
 */
export function topikTestStartMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.code === TOPIK_ERRORS.notContiguous) return t("topik.test.errorNotContiguous");
    if (error.code === TOPIK_ERRORS.tooShort) return t("topik.test.errorTooShort");
    if (error.code === TOPIK_ERRORS.bankShort) {
      const detail = bankShortBody.safeParse(error.body);
      return detail.success ? t("topik.test.errorBankShort", { position: detail.data.missing_position }) : t("topik.test.errorTooShort");
    }
    if (error.status === 404) return t("topik.test.errorNotFound");
    if (error.status >= 500) return t("topik.test.errorServer", { status: error.status });
    return t("topik.test.errorRequest", { status: error.status, code: error.code });
  }
  // Not an HTTP error at all: fetch itself failed, which on a phone is almost always the network.
  return t("topik.test.errorOffline");
}
