import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TOPIK_OPTION_COUNT, type TopikAttemptResult, type TopikPracticeQuestion, type TopikVocabEntry } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { imageUrl } from "@/features/images/api";
import { cn } from "@/lib/utils";
import { useSubmitTopikAttempt } from "./api";
import { TopikExplanation } from "./TopikExplanation";
import { TopikSessionResults } from "./TopikSessionResults";
import { TopikWordTap } from "./TopikWordPopover";
import { segmentText } from "./vocabSegments";

/** Outside the component so `react-hooks/purity` does not flag the `Date.now()` call itself. */
const elapsedSince = (start: number) => Date.now() - start;

export function TopikSession({ profileId, questions }: { profileId: string; questions: TopikPracticeQuestion[] }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<TopikAttemptResult | null>(null);
  const startedAt = useRef(0);
  const submit = useSubmitTopikAttempt();

  const question = questions[index]!;
  const done = index >= questions.length;

  useEffect(() => {
    startedAt.current = Date.now();
  }, [index]);

  if (done) return <TopikSessionResults />;

  const choose = (option: number) => {
    if (selected !== null) return;
    setSelected(option);
    submit.mutate(
      { profile_id: profileId, question_id: question.id, selected_option: option, duration_ms: elapsedSince(startedAt.current) },
      { onSuccess: setResult },
    );
  };

  const next = () => {
    setSelected(null);
    setResult(null);
    setIndex((i) => i + 1);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("topik.practice.progress", { current: index + 1, total: questions.length })}</p>
      {question.instruction && (
        <p className="font-medium">
          <TappableText text={question.instruction} vocab={question.vocab} />
        </p>
      )}
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        {question.stem.image_key && (
          <img src={imageUrl(question.stem.image_key)} alt="" className="w-full rounded-md object-contain" />
        )}
        {question.stem.text && (
          <p className="text-lg">
            <TappableText text={question.stem.text} vocab={question.vocab} />
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: TOPIK_OPTION_COUNT }, (_, i) => i + 1).map((n) => {
          const opt = question.options[n - 1]!;
          const isSelected = selected === n;
          const isCorrectOpt = result?.correct_option === n;
          const disabled = selected !== null;
          return (
            // A tappable word inside the option's text (TopikWordTap) is itself a <button>; this
            // can't be a <button> too (nested interactive elements), so it's a role="button" div —
            // its own click stops at any inner word tap via stopPropagation (see TopikWordPopover).
            <div
              key={n}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-disabled={disabled}
              onClick={() => !disabled && choose(n)}
              onKeyDown={(e) => {
                if (!disabled && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  choose(n);
                }
              }}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                result
                  ? isCorrectOpt
                    ? "border-green-600 bg-green-50 dark:bg-green-950/40"
                    : isSelected
                      ? "border-destructive bg-destructive/10"
                      : "opacity-60"
                  : "hover:bg-accent",
              )}
            >
              <span className="font-medium">{n})</span>
              {opt.image_key && <img src={imageUrl(opt.image_key)} alt="" className="h-16 w-16 rounded object-cover" />}
              {opt.text && <TappableText text={opt.text} vocab={question.vocab} />}
            </div>
          );
        })}
      </div>
      {result && (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className={result.is_correct ? "text-green-700 dark:text-green-400" : "text-destructive"}>
              {result.is_correct ? t("topik.practice.correct") : t("topik.practice.incorrect")}
            </p>
            <Button onClick={next}>{index + 1 < questions.length ? t("topik.practice.next") : t("topik.practice.finish")}</Button>
          </div>
          <TopikExplanation explanation_vi={result.explanation_vi} key_terms={result.key_terms} autoShow={!result.is_correct} />
        </>
      )}
    </div>
  );
}

/** Renders `text` with its AI-found words tappable (M6.2): read-only, nothing is marked by default. */
function TappableText({ text, vocab }: { text: string; vocab: TopikVocabEntry[] }) {
  return (
    <span lang="ko">
      {segmentText(text, vocab).map((seg, i) =>
        seg.entry ? <TopikWordTap key={i} entry={seg.entry} /> : <Fragment key={i}>{seg.text}</Fragment>,
      )}
    </span>
  );
}
