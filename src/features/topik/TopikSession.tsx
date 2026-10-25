import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { TOPIK_OPTION_COUNT, type TopikPracticeQuestion, type TopikVocabEntry } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { imageUrl } from "@/features/images/api";
import { cn } from "@/lib/utils";
import { useSubmitTopikAttempt, useTopikQuestionContent, useTopikQuestionStats } from "./api";
import { markSkippedIfUnanswered, recordAnswer, statusOf, summarize, withExplanation, type SessionStates } from "./sessionState";
import { TopikClipPlayer } from "./TopikClipPlayer";
import { TopikExplanation } from "./TopikExplanation";
import { TopikTranscript } from "./TopikTranscript";
import { TopikSessionResults } from "./TopikSessionResults";
import { TopikWordTap } from "./TopikWordPopover";
import { segmentTextWithUnderline } from "./vocabSegments";

/** Outside the component so `react-hooks/purity` does not flag the `Date.now()` call itself. */
const elapsedSince = (start: number) => Date.now() - start;

export function TopikSession({ profileId, questions }: { profileId: string; questions: TopikPracticeQuestion[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [index, setIndex] = useState(0);
  const [states, setStates] = useState<SessionStates>({});
  const startedAt = useRef(0);
  const submit = useSubmitTopikAttempt();

  const rawQuestion = questions[index];
  const done = index >= questions.length;

  useEffect(() => {
    startedAt.current = Date.now();
  }, [index]);

  // M6.4-ish: generation for this session's questions was kicked off by GET /topik/session itself and
  // may still be running — poll the current question until its vocabulary is ready, so "tap a word"
  // starts working as soon as it exists without ever blocking the question from being answered.
  // Derived at render time (not patched into state via an effect) so a poll tick just re-renders
  // with the freshly-ready data instead of needing its own setState.
  const vocabPoll = useTopikQuestionContent(rawQuestion?.id ?? "", profileId, !!rawQuestion && !rawQuestion.vocab_ready);
  const question =
    rawQuestion && !rawQuestion.vocab_ready && vocabPoll.data?.vocab_ready
      ? { ...rawQuestion, vocab: vocabPoll.data.vocab, vocab_ready: true }
      : rawQuestion;

  const entry = question ? states[question.id] : undefined;

  // Same idea for the answer explanation: the attempt response may arrive before the background
  // job that generates it has finished, so keep polling and derive the up-to-date entry to render.
  const explainPoll = useTopikQuestionContent(rawQuestion?.id ?? "", profileId, entry?.kind === "answered" && !entry.result.explain_ready);
  const effectiveEntry =
    entry?.kind === "answered" && !entry.result.explain_ready && explainPoll.data?.explain_ready
      ? withExplanation(entry, explainPoll.data.explanation_vi, explainPoll.data.key_terms)
      : entry;
  const effectiveResult = effectiveEntry?.kind === "answered" ? effectiveEntry.result : null;
  const selectedOption = effectiveEntry?.kind === "answered" ? effectiveEntry.selected : null;

  // One profile's own full history on this question ("7/10 đúng"), shown small at the bottom —
  // never a spoiler, just a personal tally. Refetched right after answering (see `choose` below).
  const stats = useTopikQuestionStats(question?.id ?? "", profileId);

  if (done || !question) return <TopikSessionResults summary={summarize(questions.map((q) => q.id), states)} />;

  const choose = (option: number) => {
    if (selectedOption !== null) return;
    submit.mutate(
      { profile_id: profileId, question_id: question.id, selected_option: option, duration_ms: elapsedSince(startedAt.current) },
      {
        onSuccess: (result) => {
          setStates((s) => recordAnswer(s, question.id, option, result));
          void qc.invalidateQueries({ queryKey: ["topik", "stats", question.id, profileId] });
        },
      },
    );
  };

  // Leaving a question that was never answered marks it "skipped" (M6.5-ish Prev/Next): it stays
  // in the session and can still be answered later by coming back to it — this never touches
  // `topik_cards`/`topik_attempts` (no `submit.mutate` call), so it is never scored wrong.
  const goTo = (i: number) => {
    setStates((s) => markSkippedIfUnanswered(s, question.id));
    setIndex(i);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm text-muted-foreground">{t("topik.practice.progress", { current: index + 1, total: questions.length })}</p>
        <p className="text-xs text-muted-foreground">{question.exam}</p>
      </div>
      <div className="flex flex-wrap gap-1">
        {questions.map((q, i) => {
          const st = statusOf(states, q.id);
          const qEntry = states[q.id];
          const isCorrectQ = qEntry?.kind === "answered" && qEntry.result.is_correct;
          return (
            // The dot itself is small (~24px) to save space, but the button's own padding keeps the
            // actual tappable area around ~32px — smaller than this app's usual 44px rule, but an
            // explicit, deliberate exception for this dense per-question navigation strip.
            <button
              key={q.id}
              type="button"
              onClick={() => i !== index && goTo(i)}
              aria-current={i === index ? "step" : undefined}
              aria-label={t("topik.practice.jumpTo", { n: i + 1, status: t(`topik.practice.status.${st}`) })}
              className="flex items-center justify-center rounded-full p-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border text-xs font-medium",
                  i === index && "ring-2 ring-ring ring-offset-1",
                  st === "answered" &&
                    (isCorrectQ
                      ? "border-green-600 bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                      : "border-destructive bg-destructive/10 text-destructive"),
                  st === "skipped" && "border-dashed text-muted-foreground",
                  st === "unanswered" && "text-muted-foreground",
                )}
              >
                {i + 1}
              </span>
            </button>
          );
        })}
      </div>
      {!question.vocab_ready && <p className="text-xs text-muted-foreground">{t("topik.practice.vocabLoading")}</p>}
      {question.instruction && (
        <p className="font-medium">
          <TappableText text={question.instruction} vocab={question.vocab} />
        </p>
      )}
      {/* A listening question has no stem to read: its transcript is withheld by the server until
          the answer is in (M7.1), and what takes its place is the clip. */}
      {question.audio ? (
        <TopikClipPlayer clip={question.audio} questionId={question.id} />
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          {question.stem.image_key && <img src={imageUrl(question.stem.image_key)} alt="" className="w-full rounded-md object-contain" />}
          {question.stem.text && (
            <p className="text-lg">
              <TappableText text={question.stem.text} vocab={question.vocab} />
            </p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {Array.from({ length: TOPIK_OPTION_COUNT }, (_, i) => i + 1).map((n) => {
          const opt = question.options[n - 1]!;
          const isSelected = selectedOption === n;
          const isCorrectOpt = effectiveResult?.correct_option === n;
          const disabled = selectedOption !== null;
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
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                effectiveResult
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
      {effectiveResult && (
        <p className={effectiveResult.is_correct ? "text-green-700 dark:text-green-400" : "text-destructive"}>
          {effectiveResult.is_correct ? t("topik.practice.correct") : t("topik.practice.incorrect")}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={() => goTo(index - 1)} disabled={index === 0}>
          {t("topik.practice.prev")}
        </Button>
        <Button onClick={() => goTo(index + 1)}>{index + 1 < questions.length ? t("topik.practice.next") : t("topik.practice.finish")}</Button>
      </div>
      {/* Only now may the transcript be read — this is where a listening question is learnt from. */}
      {effectiveResult?.transcript && <TopikTranscript text={effectiveResult.transcript} vocab={effectiveResult.vocab} />}
      {effectiveResult && (
        <TopikExplanation
          explanation_vi={effectiveResult.explanation_vi}
          key_terms={effectiveResult.key_terms}
          ready={effectiveResult.explain_ready}
          autoShow={!effectiveResult.is_correct}
        />
      )}
      <p className="text-center text-xs text-muted-foreground">
        {stats.data
          ? stats.data.attempts > 0
            ? t("topik.practice.personalStats", { correct: stats.data.correct, attempts: stats.data.attempts })
            : t("topik.practice.personalStatsNone")
          : " "}
      </p>
    </div>
  );
}

/** Renders `text` with its AI-found words tappable (M6.2) and any `<u>…</u>`-marked phrase (M6.5-ish
 * — 문항 3-4's "choose the closest meaning to the underlined part") bold+underlined: read-only,
 * nothing is marked by default. Built as React elements (never `dangerouslySetInnerHTML`) — the
 * markup is parsed into plain data (`segmentTextWithUnderline`) before any rendering happens. */
function TappableText({ text, vocab }: { text: string; vocab: TopikVocabEntry[] }) {
  return (
    <span lang="ko" className="whitespace-pre-wrap">
      {segmentTextWithUnderline(text, vocab).map((seg, i) => {
        const content = seg.entry ? <TopikWordTap entry={seg.entry} /> : seg.text;
        return seg.underlined ? (
          <strong key={i} className="underline">
            {content}
          </strong>
        ) : (
          <Fragment key={i}>{content}</Fragment>
        );
      })}
    </span>
  );
}
