import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TopikVocabEntry } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { TopikWordTap } from "./TopikWordPopover";
import { segmentTextWithUnderline } from "./vocabSegments";

/**
 * A listening question's transcript, shown only after answering (M7.1).
 *
 * It stays behind a button rather than appearing on its own: reading the dialogue right after
 * hearing it is where most of the learning happens, but only once the learner has committed to an
 * answer. Words are tappable here exactly as in a reading question.
 */
export function TopikTranscript({ text, vocab }: { text: string; vocab: TopikVocabEntry[] }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);

  if (!shown) {
    return (
      <Button type="button" variant="outline" onClick={() => setShown(true)}>
        {t("topik.practice.showTranscript")}
      </Button>
    );
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border p-3">
      <h2 className="font-semibold">{t("topik.practice.transcript")}</h2>
      <p lang="ko" className="whitespace-pre-wrap">
        {segmentTextWithUnderline(text, vocab).map((seg, i) => (
          <span key={i}>{seg.entry ? <TopikWordTap entry={seg.entry} /> : seg.text}</span>
        ))}
      </p>
    </section>
  );
}
