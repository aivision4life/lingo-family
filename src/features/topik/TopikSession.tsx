import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { TopikPracticeQuestion, TopikRevealEntry, TopikSessionMode } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRevealTopikGroup, useSubmitTopikAttempt } from "./api";
import { groupIndexOf, groupNumbers, groupQuestions, questionsBefore } from "./groups";
import {
  allAnswered,
  anyGivenUp,
  giveUp,
  markSkippedIfUnanswered,
  recordAnswer,
  statusOf,
  summarize,
  type SessionStates,
} from "./sessionState";
import { TopikClipPlayer } from "./TopikClipPlayer";
import { TopikQuestionCard } from "./TopikQuestionCard";
import { TopikSessionResults } from "./TopikSessionResults";
import { TopikTranscript } from "./TopikTranscript";

/** Outside the component so `react-hooks/purity` does not flag the `Date.now()` call itself. */
const elapsedSince = (start: number) => Date.now() - start;

/**
 * A practice session, one **group** of questions per screen (M7.5).
 *
 * From question 21 a recording is followed by two questions, and the real paper prints them on one
 * page: the tape plays once, so both have to be answerable while it is fresh — in either order,
 * either of them left blank. The transcript and the explanations appear only when every question
 * on the screen has been answered, or when the learner deliberately gives the group up to read it:
 * shown earlier, the recording's own words would hand over the answer to the question next to it.
 */
export function TopikSession({
  profileId,
  questions,
  mode = "due",
}: {
  profileId: string;
  questions: TopikPracticeQuestion[];
  /** "all" = practising ahead of the schedule: answers are recorded but change no due dates. */
  mode?: TopikSessionMode;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [index, setIndex] = useState(0);
  const [states, setStates] = useState<SessionStates>({});
  /** The transcript + explanations of groups that may now be read, keyed by question id. */
  const [reveals, setReveals] = useState<Record<string, TopikRevealEntry>>({});
  const startedAt = useRef(0);
  const submit = useSubmitTopikAttempt();
  const reveal = useRevealTopikGroup();

  const groups = groupQuestions(questions);
  const group = groups[index];
  const done = index >= groups.length;

  useEffect(() => {
    startedAt.current = Date.now();
  }, [index]);

  if (done || !group) return <TopikSessionResults summary={summarize(questions.map((q) => q.id), states)} />;

  const ids = group.questions.map((q) => q.id);
  const { from, to } = groupNumbers(group);
  const answeredCount = questions.filter((q) => statusOf(states, q.id) === "answered").length;
  const readable = allAnswered(states, ids) || anyGivenUp(states, ids);
  const keepReveals = (entries: TopikRevealEntry[]) =>
    setReveals((r) => ({ ...r, ...Object.fromEntries(entries.map((e) => [e.question_id, e])) }));

  const choose = (question: TopikPracticeQuestion, option: number) => {
    if (statusOf(states, question.id) !== "unanswered") return;
    // The server decides what may be sent back: while a sibling is unanswered it withholds the
    // transcript and the explanation, which answer that sibling too.
    const pending = ids.some((id) => id !== question.id && statusOf(states, id) !== "answered");
    submit.mutate(
      {
        profile_id: profileId,
        question_id: question.id,
        selected_option: option,
        duration_ms: elapsedSince(startedAt.current),
        schedule: mode === "due",
        group_pending: pending,
      },
      {
        onSuccess: (result) => {
          setStates((s) => recordAnswer(s, question.id, option, result));
          keepReveals(result.group_reveal);
          void qc.invalidateQueries({ queryKey: ["topik", "stats", question.id, profileId] });
        },
      },
    );
  };

  /** Reading the recording's words instead of answering: the rest of the group is locked for good. */
  const readInstead = () => {
    reveal.mutate(
      { question_id: ids[0]!, profile_id: profileId },
      {
        onSuccess: ({ group: entries }) => {
          keepReveals(entries);
          setStates((s) => giveUp(s, ids));
        },
      },
    );
  };

  // Leaving a question that was never answered marks it "skipped": it stays in the session and can
  // still be answered by coming back — nothing is written to `topik_cards`/`topik_attempts`, so it
  // is never scored wrong. A group that was given up on keeps that state instead (see `giveUp`).
  const goTo = (i: number) => {
    setStates((s) => ids.reduce(markSkippedIfUnanswered, s));
    setIndex(i);
  };

  const transcript = group.questions.map((q) => reveals[q.id]).find((r) => r?.transcript);

  return (
    <div className="flex flex-col gap-4">
      {/* Always visible, not a one-off toast: every answer in this session is deliberately outside
          the schedule, and that has to stay obvious while answering, not just when it started. */}
      {mode === "all" && (
        <p role="status" className="rounded-lg border border-amber-500 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/40">
          {t("topik.practice.extraBanner")}
        </p>
      )}

      <div className="flex flex-col gap-0.5">
        <p className="text-sm text-muted-foreground">{t("topik.practice.answeredCount", { answered: answeredCount, total: questions.length })}</p>
        {/* The exam's own numbers, not positions in this session: when something in a question
            looks wrong, that number is what finds it again in the source file. */}
        <p className="text-xs text-muted-foreground">
          {from === to
            ? t("topik.practice.examQuestion", { exam: group.questions[0]!.exam, number: from })
            : t("topik.practice.examQuestions", { exam: group.questions[0]!.exam, from, to })}
        </p>
      </div>

      {/* One dot per question, not per screen: the two halves of a pair are answered separately. */}
      <div className="flex flex-wrap gap-1">
        {questions.map((q, i) => {
          const st = statusOf(states, q.id);
          const entry = states[q.id];
          const isCorrectQ = entry?.kind === "answered" && entry.result.is_correct;
          const onThisScreen = ids.includes(q.id);
          return (
            // The dot itself is small (~24px) but the button's padding keeps the tappable area at
            // ~32px — smaller than this app's usual 44px, a deliberate exception for this strip.
            <button
              key={q.id}
              type="button"
              onClick={() => !onThisScreen && goTo(groupIndexOf(groups, q.id))}
              aria-current={onThisScreen ? "step" : undefined}
              aria-label={t("topik.practice.jumpTo", { n: i + 1, status: t(`topik.practice.status.${st}`) })}
              className="flex items-center justify-center rounded-full p-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border text-xs font-medium",
                  onThisScreen && "ring-2 ring-ring ring-offset-1",
                  st === "answered" &&
                    (isCorrectQ
                      ? "border-green-600 bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                      : "border-destructive bg-destructive/10 text-destructive"),
                  (st === "skipped" || st === "given_up") && "border-dashed text-muted-foreground",
                  st === "unanswered" && "text-muted-foreground",
                )}
              >
                {i + 1}
              </span>
            </button>
          );
        })}
      </div>

      {/* One player for the whole screen: a pair is one recording, played once. */}
      {group.questions[0]?.audio && <TopikClipPlayer clip={group.questions[0].audio} questionId={group.group_id} />}
      {group.questions.length > 1 && <p className="text-sm text-muted-foreground">{t("topik.practice.pairNote")}</p>}

      {group.questions.map((question) => (
        <TopikQuestionCard
          key={question.id}
          question={question}
          profileId={profileId}
          state={states[question.id]}
          reveal={readable ? (reveals[question.id] ?? null) : null}
          showNumber={group.questions.length > 1}
          onChoose={(option) => choose(question, option)}
        />
      ))}

      {/* Only now may the transcript be read — this is where a listening question is learnt from. */}
      {readable && transcript?.transcript && <TopikTranscript text={transcript.transcript} vocab={transcript.vocab} />}

      {/* Giving up is a deliberate trade: the words of the recording for the right to answer. */}
      {!readable && group.questions[0]?.audio && (
        <div className="flex flex-col items-start gap-1">
          <Button variant="outline" onClick={readInstead} disabled={reveal.isPending}>
            {t("topik.practice.giveUp")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("topik.practice.giveUpHint")}</p>
          {reveal.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t("topik.practice.giveUpError")}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={() => goTo(index - 1)} disabled={index === 0}>
          {t("topik.practice.prev")}
        </Button>
        <Button onClick={() => goTo(index + 1)}>
          {questionsBefore(groups, index + 1) < questions.length ? t("topik.practice.next") : t("topik.practice.finish")}
        </Button>
      </div>
    </div>
  );
}
