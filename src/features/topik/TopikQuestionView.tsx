import { Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { splitUnderline, TOPIK_OPTION_COUNT, type TopikClip, type TopikQuestion } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { playSegment, stopAudio, useAudioPlayer } from "@/features/audio/player";
import { imageUrl } from "@/features/images/api";
import { cn } from "@/lib/utils";
import { keyTermRows } from "./questionPreview";
import { formatTimeInput, practiceEnd } from "./segmentEdit";

/**
 * Screen (M6.7) — read-only view of one question from the review list, laid out the way practice
 * shows it (instruction, stem with its image at full width, all 4 options), plus the things
 * practice hides until you answer: which option is correct, and the AI explanation / key terms.
 *
 * Deliberately *not* the edit form: that form exists for typing, so it shows every field as an
 * input and makes reading a long stem awkward — which is exactly the problem this screen fixes.
 * Words are not tappable here either (that is a practice feature: it marks terms for the
 * end-of-session bulk add, which has no meaning outside a session).
 */
export function TopikQuestionView({ question, onEdit, onBack }: { question: TopikQuestion; onEdit: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const keyTerms = keyTermRows(question.key_terms, question.vocab);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm text-muted-foreground">
          {question.exam} · #{question.number} · {t("topik.blockLabel", { block: question.block })}
          {!question.verified && ` · ${t("topik.manage.unverifiedBadge")}`}
        </p>
        {question.warning && <p className="text-sm text-amber-700 dark:text-amber-500">⚠ {question.warning}</p>}
      </div>

      {question.instruction && (
        <p className="font-medium">
          <KoreanText text={question.instruction} />
        </p>
      )}

      {/* Listening: the clip is the question. Not auto-played here — this screen is for checking
          content, and a 2-minute dialogue starting by itself on every row opened is a nuisance. */}
      {question.audio && <ClipButton clip={question.audio} />}

      <div className="flex flex-col gap-2 rounded-lg border p-4">
        {question.stem.image_key && (
          <img src={imageUrl(question.stem.image_key)} alt="" className="w-full rounded-md object-contain" />
        )}
        {question.stem.text ? (
          <p className="text-lg">
            <KoreanText text={question.stem.text} />
          </p>
        ) : (
          !question.stem.image_key && <p className="text-muted-foreground">{t("topik.view.noStem")}</p>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {Array.from({ length: TOPIK_OPTION_COUNT }, (_, i) => i + 1).map((n) => {
          const opt = question.options[n - 1];
          const isCorrect = question.correct_option === n;
          return (
            <li
              key={n}
              className={cn(
                "flex min-h-11 items-start gap-3 rounded-lg border p-3",
                isCorrect && "border-green-600 bg-green-50 dark:bg-green-950/40",
              )}
            >
              <span className="font-medium">{n})</span>
              {opt?.image_key && <img src={imageUrl(opt.image_key)} alt="" className="h-24 w-24 rounded object-contain" />}
              {opt?.text && <KoreanText text={opt.text} />}
              {isCorrect && (
                <span className="ms-auto shrink-0 text-sm font-medium text-green-700 dark:text-green-400">
                  {t("topik.view.correctBadge")}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <section className="flex flex-col gap-2 rounded-lg border p-3">
        <h2 className="font-semibold">{t("topik.view.explanation")}</h2>
        {question.explanation_vi ? (
          <p className="whitespace-pre-wrap">{question.explanation_vi}</p>
        ) : (
          <p className="text-muted-foreground">
            {t(question.explain_ready ? "topik.view.explanationNone" : "topik.view.explanationPending")}
          </p>
        )}
        {keyTerms.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {keyTerms.map((term) => (
              <li key={term.lemma}>
                <span lang="ko" className="font-medium">
                  {term.lemma}
                </span>
                {term.gloss_vi ? ` — ${term.gloss_vi}` : ` — ${t("topik.view.termNoGloss")}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onEdit}>{t("topik.manage.edit")}</Button>
        <Button variant="ghost" onClick={onBack}>
          {t("common.back")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Korean text with its line breaks kept and any `<u>…</u>`-marked phrase shown bold+underlined
 * (문항 3-4 asks about exactly that phrase, so it must stay visible while reviewing). Built as React
 * elements from parsed data — never `dangerouslySetInnerHTML`; `<보기>` and friends stay literal.
 */
function KoreanText({ text }: { text: string }) {
  return (
    <span lang="ko" className="whitespace-pre-wrap">
      {splitUnderline(text).map((run, i) =>
        run.underlined ? (
          <strong key={i} className="underline">
            {run.text}
          </strong>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </span>
  );
}

/** Plays one clip on demand, the way practice would (talking plus a short pause). */
function ClipButton({ clip }: { clip: TopikClip }) {
  const { t } = useTranslation();
  const { playingKey } = useAudioPlayer();
  const playing = playingKey !== null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        onClick={() => (playing ? stopAudio() : playSegment(clip.audio_key, clip.start_ms, practiceEnd(clip)))}
      >
        {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
        {t(playing ? "topik.practice.stopAudio" : "topik.practice.playAudio")}
      </Button>
      <span className="text-sm text-muted-foreground">
        {formatTimeInput(clip.start_ms)} → {formatTimeInput(clip.speech_end_ms)}
      </span>
    </div>
  );
}
