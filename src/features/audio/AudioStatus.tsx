import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { z } from "zod";
import type { AudioFailure } from "@shared/audioFailure";
import { WORD_ERRORS, type WordDetail } from "@shared/word";
import { Button } from "@/components/ui/button";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { nextUtcMidnight } from "@/features/images/quotaReset";
import { useGenerateAudio } from "@/features/words/api";
import { ApiError } from "@/lib/api";

/** One message per reason, so three very different problems stop reading the same. */
const FAILURE_KEYS = {
  quota: "audio.failed.quota",
  provider_rejected: "audio.failed.rejected",
  provider_error: "audio.failed.provider",
  not_configured: "audio.notConfigured",
} as const satisfies Record<AudioFailure, string>;

/** The TTS allowance resets at UTC midnight, shown in the viewer's own device time. */
const resetTime = (locale: string) =>
  nextUtcMidnight().toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Set by the Add word screen when some audio could not be generated while saving. */
const navStateSchema = z.object({ audioMissing: z.number() });

/** Light notice + "Generate audio" button, shown only while the word or an example lacks audio. */
export function AudioStatus({ word }: { word: WordDetail }) {
  const { i18n, t } = useTranslation();
  const location = useLocation();
  const { profile } = useActiveProfile();
  const generate = useGenerateAudio(word.id);

  // The word, its phrases and every example (of the word or of a phrase) need audio.
  const missing =
    (word.audio_key ? 0 : 1) +
    word.examples.filter((ex) => !ex.audio_key).length +
    word.phrases.reduce((n, p) => n + (p.audio_key ? 0 : 1) + p.examples.filter((ex) => !ex.audio_key).length, 0);
  const nav = navStateSchema.safeParse(location.state);
  const justSavedWithoutAudio = nav.success && nav.data.audioMissing > 0;

  if (generate.data?.missing === 0) {
    return <p role="status" className="text-sm text-muted-foreground">{t("audio.done")}</p>;
  }
  if (missing === 0 || !profile || !canManageProfiles(profile)) return null;

  let message: string = justSavedWithoutAudio ? t("audio.savedWithoutAudio") : t("audio.missing");
  if (generate.data) {
    // Why, not just how many (M7.13): waiting helps a busy service, waiting until tomorrow helps
    // an exhausted quota, and waiting never helps a key the provider refuses. On a phone there is
    // nowhere else to find this out.
    message = generate.data.reason
      ? t(FAILURE_KEYS[generate.data.reason], { count: generate.data.missing, time: resetTime(i18n.language) })
      : t("audio.stillMissing", { count: generate.data.missing });
  }
  if (generate.error) {
    message =
      generate.error instanceof ApiError && generate.error.code === WORD_ERRORS.ttsNotConfigured
        ? t("audio.notConfigured")
        : t("words.errors.generic");
  }

  return (
    <div role="status" className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
      <p>{message}</p>
      <Button variant="outline" disabled={generate.isPending} onClick={() => generate.mutate(profile.id)}>
        <RefreshCw aria-hidden className={generate.isPending ? "animate-spin" : undefined} />
        {generate.isPending ? t("audio.generating") : t("audio.generate")}
      </Button>
    </div>
  );
}
