import { X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { TOPIK_OPTION_COUNT, type TopikPracticeQuestion, type TopikVocabEntry } from "@shared/topik";
import { LinkButton } from "@/components/LinkButton";
import { Button } from "@/components/ui/button";
import { imageUrl } from "@/features/images/api";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { cn } from "@/lib/utils";
import { useSubmitTopikAttempt, useTopikSession } from "@/features/topik/api";
import { TopikWordTap } from "@/features/topik/TopikWordPopover";
import { segmentText } from "@/features/topik/vocabSegments";

/** Outside the component so `react-hooks/purity` does not flag the `Date.now()` call itself. */
const elapsedSince = (start: number) => Date.now() - start;

/** Screen (M6.1) — `/topik/practice?from=&to=`: one TOPIK question at a time, answer revealed at once. */
export function TopikPracticePage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const [params] = useSearchParams();
  const from = Number(params.get("from"));
  const to = Number(params.get("to"));
  const session = useTopikSession(profile?.id ?? "", from, to);

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t("topik.practice.title", { from, to })}</h1>
        <LinkButton to="/topik" variant="outline">
          <X aria-hidden />
          {t("topik.practice.exit")}
        </LinkButton>
      </div>
      {!profile ? null : session.isPending ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : session.isError ? (
        <p className="text-destructive">{t("common.loadError")}</p>
      ) : session.data.questions.length === 0 ? (
        <p className="py-10 text-center text-lg">{t("topik.practice.nothingToday")}</p>
      ) : (
        <Session key={session.dataUpdatedAt} profileId={profile.id} questions={session.data.questions} />
      )}
    </section>
  );
}

function Session({ profileId, questions }: { profileId: string; questions: TopikPracticeQuestion[] }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<{ is_correct: boolean; correct_option: number } | null>(null);
  const startedAt = useRef(0);
  const submit = useSubmitTopikAttempt();

  const question = questions[index]!;
  const done = index >= questions.length;

  useEffect(() => {
    startedAt.current = Date.now();
  }, [index]);

  if (done) {
    return <p className="py-10 text-center text-lg">{t("topik.practice.sessionDone")}</p>;
  }

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
        <div className="flex items-center justify-between gap-2">
          <p className={result.is_correct ? "text-green-700 dark:text-green-400" : "text-destructive"}>
            {result.is_correct ? t("topik.practice.correct") : t("topik.practice.incorrect")}
          </p>
          <Button onClick={next}>{index + 1 < questions.length ? t("topik.practice.next") : t("topik.practice.finish")}</Button>
        </div>
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
