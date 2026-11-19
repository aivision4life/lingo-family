import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { PronScoreResponse } from "@shared/pron";
import { SPEAKING_MAX_TAKES } from "@shared/speaking";
import type { QueueItem } from "@shared/review";
import { RecordScore, type PronTarget } from "@/features/pron/RecordScore";

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};
/** Scoring needs the Worker, which needs the network: offline the card is skipped, never failed. */
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

type Props = { item: QueueItem; profileId: string; onScored: (result: PronScoreResponse) => void };

/**
 * The recording half of a speaking card (M3.3, SPEC F4/F5): the same "Record & score" the Focus
 * view uses (M3.2), limited to `SPEAKING_MAX_TAKES` takes on one card because every take is an
 * uncacheable paid call.
 *
 * It never decides anything: the ids of the scored takes go up to the server, which reads back the
 * scores it stored and states the rating (the M7.24 rule).
 */
export function SpeakingPrompt({ item, profileId, onScored }: Props) {
  const { t } = useTranslation();
  const online = useOnline();
  const target: PronTarget = { kind: item.word.kind, id: item.word.id };

  if (!online) {
    return (
      <p role="status" className="max-w-md text-center text-sm text-muted-foreground">
        {t("review.speaking.offline")}
      </p>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <p className="text-sm text-muted-foreground">{t("review.speaking.hint")}</p>
      <RecordScore
        target={target}
        lang={item.word.lang}
        text={item.word.term}
        profileId={profileId}
        maxTakes={SPEAKING_MAX_TAKES}
        onScored={onScored}
      />
    </div>
  );
}
