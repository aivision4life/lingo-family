import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { TopikSection } from "@shared/enums";
import type { TopikPracticeQuestion, TopikRevealEntry, TopikSessionMode } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRevealTopikGroup, useSubmitTopikAttempt } from "./api";
import { groupIndexOf, groupNumbers, groupQuestions, questionsBefore } from "./groups";
import { useMarkedWords } from "./markedWords";
import { clearSession, writeSession, type SavedSession } from "./sessionProgress";
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

/** How long "resumed where you left off" stays on screen. */
const RESUMED_NOTICE_MS = 8000;

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
  section,
  from,
  to,
  mode = "due",
  restored = null,
}: {
  profileId: string;
  questions: TopikPracticeQuestion[];
  /** The block this session came from — stored with the progress so a record can only ever be
   * restored onto the screen it was made on (`restoreSession`). */
  section: TopikSection;
  from: number;
  to: number;
  /** "all" = practising ahead of the schedule: answers are recorded but change no due dates. */
  mode?: TopikSessionMode;
  /** Progress left on this device by an interrupted session, already checked against what the
   * server just served (M7.19). The page decides; this component only resumes from it. */
  restored?: SavedSession | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { marked } = useMarkedWords();
  const groups = groupQuestions(questions);
  // Clamped: a record is only restored onto the same question set, so this is a safety net, not
  // an expected case.
  const [index, setIndex] = useState(() => Math.min(restored?.index ?? 0, groups.length));
  const [states, setStates] = useState<SessionStates>(() => restored?.states ?? {});
  /** The transcript + explanations of groups that may now be read, keyed by question id.
   * Deliberately not saved: it is the heaviest part of a session and `GET .../reveal` can serve
   * it again, so a resumed session shows the clip's words only once they are asked for anew. */
  const [reveals, setReveals] = useState<Record<string, TopikRevealEntry>>({});
  /** "Resumed where you left off" — without it, opening a block and landing on question 4 of 5
   * with three answers already in is just confusing. */
  const [resumed, setResumed] = useState(restored !== null);
  const startedAt = useRef(0);
  const submit = useSubmitTopikAttempt();
  const reveal = useRevealTopikGroup();

  const group = groups[index];
  const done = index >= groups.length;

  useEffect(() => {
    startedAt.current = Date.now();
  }, [index]);

  // The notice goes away by itself; answering also clears it (see `choose`).
  useEffect(() => {
    if (!resumed) return;
    const timer = setTimeout(() => setResumed(false), RESUMED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [resumed]);

  /**
   * Progress, saved on the device after every change (M7.19).
   *
   * Runs on mount too, so a session that is interrupted before the first answer still comes back
   * with its place. The record is dropped only once the session is over **and** no marked word is
   * waiting: the results screen is where words are added to the library, and that list is the one
   * thing here that cannot be rebuilt from the server.
   */
  useEffect(() => {
    if (done && marked.length === 0) {
      clearSession(profileId);
      return;
    }
    writeSession({
      v: 1,
      profile_id: profileId,
      section,
      from,
      to,
      mode,
      questions,
      index,
      states,
      marked,
      saved_at: Date.now(),
    });
  }, [done, profileId, section, from, to, mode, questions, index, states, marked]);

  if (done || !group) return <TopikSessionResults summary={summarize(questions.map((q) => q.id), states)} />;

  const ids = group.questions.map((q) => q.id);
  // The group's own question numbers — not to be confused with the block range in the props.
  const { from: firstNumber, to: lastNumber } = groupNumbers(group);
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
          setResumed(false);
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

      {resumed && (
        <p role="status" className="rounded-lg border bg-muted px-3 py-2 text-sm">
          {t("topik.practice.resumed")}
        </p>
      )}

      <div className="flex flex-col gap-0.5">
        <p className="text-sm text-muted-foreground">{t("topik.practice.answeredCount", { answered: answeredCount, total: questions.length })}</p>
        {/* The exam's own numbers, not positions in this session: when something in a question
            looks wrong, that number is what finds it again in the source file. */}
        <p className="text-xs text-muted-foreground">
          {firstNumber === lastNumber
            ? t("topik.practice.examQuestion", { exam: group.questions[0]!.exam, number: firstNumber })
            : t("topik.practice.examQuestions", { exam: group.questions[0]!.exam, from: firstNumber, to: lastNumber })}
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
      {/* What the two questions share decides the sentence: a clip plays once, a passage is read.
          Saying "đoạn nghe" above a reading passage was the first thing visible when reading pairs
          arrived (M7.21), and the group's own data already knew which it was. */}
      {group.questions.length > 1 && (
        <p className="text-sm text-muted-foreground">{t(group.questions[0]?.audio ? "topik.practice.pairNote" : "topik.practice.passageNote")}</p>
      )}

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
