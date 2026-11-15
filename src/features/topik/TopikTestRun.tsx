import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker, useNavigate } from "react-router";
import type { TopikTestQuestion, TopikTestResult, TopikTestRun } from "@shared/topik";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { imageUrl } from "@/features/images/api";
import { Button } from "@/components/ui/button";
import { useAbandonTopikTest, useFinishTopikTest, useSaveTopikTestAnswer } from "./api";
import { answerAcknowledged, answerGiven, answeredCount, emptyQueue, unsentAnswers, type AnswerQueue } from "./answerQueue";
import { groupNumbers, groupQuestions } from "./groups";
import { isInLastMinutes } from "./readingClock";
import { sharedStem, stemView } from "./questionStem";
import { KoreanText } from "./KoreanText";
import { TopikTestGrid } from "./TopikTestGrid";
import { formatRemaining, isParked, positionAt, progressFraction, shownPosition, type ParkedAt } from "./testClock";
import { sittingHeader, type SittingHeader } from "./sittingHeader";
import { TopikTestQuestionCard } from "./TopikTestQuestionCard";
import { TopikTimeWarning } from "./TopikTimeWarning";
import { useSittingTape } from "./useSittingTape";
import { useTestClock } from "./useTestClock";



/**
 * Sitting a mock test (M6.4). The recording paces the paper: it runs from the first clip's start to
 * the last clip's end, answering silences included, and which question is "current" follows the
 * playing head. There is no replay, no speed control and no seeking — that is the exercise.
 *
 * Going back to change an earlier answer *is* allowed while the tape runs, because flipping back a
 * page is allowed in the real exam.
 *
 * The time is the server's (M7.13, `useTestClock`). Closing the paper does not stop it, which is
 * what makes a sitting worth anything — so the pause button is deliberately the biggest control on
 * the screen, and leaving says plainly that the clock keeps running.
 */
export function TopikTestRun({ test, profileId, onFinished }: { test: TopikTestRun; profileId: string; onFinished: (r: TopikTestResult) => void }) {
  const { t } = useTranslation();
  /** The header's four states turned into words; the choice between them is `sittingHeader`.
   * Kept inside the component so it can use `t` as it is, without writing out i18next's own `t`
   * type — doing that makes TypeScript give up on the typed resources ("excessively deep"). */
  const headerText = (header: SittingHeader): string => {
    switch (header.kind) {
      case "single":
        return t("topik.test.atQuestion", { number: header.number, total: header.total });
      case "pair":
        return t("topik.test.atQuestions", { from: header.first, to: header.last, total: header.total });
      case "singleInRange":
        return t("topik.test.atQuestionInRange", { number: header.number, from: header.from, to: header.to });
      case "pairInRange":
        return t("topik.test.atQuestionsInRange", { first: header.first, last: header.last, from: header.from, to: header.to });
    }
  };
  const navigate = useNavigate();
  const save = useSaveTopikTestAnswer();
  const finish = useFinishTopikTest();
  const abandon = useAbandonTopikTest();

  const [queue, setQueue] = useState<AnswerQueue>(() =>
    test.questions.reduce<AnswerQueue>(
      (q, question) => (question.selected_option === null ? q : { ...q, answers: { ...q.answers, [question.position]: question.selected_option } }),
      emptyQueue,
    ),
  );
  // Where the learner went back to, and where the tape was when they did (see `shownPosition`).
  const [park, setPark] = useState<ParkedAt>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const submitted = useRef(false);
  /** Set the moment the learner confirms leaving, so the blocker stops blocking that very exit. */
  const leaving = useRef(false);
  // Set on the first effect run rather than during render: `react-hooks/purity` refuses a clock
  // read while rendering, and the sitting starts when the tape does anyway.
  const clock = useTestClock(test, profileId);
  const tape = useSittingTape(test, clock);
  // A screen is a group: the questions about one recording, which the tape plays once (M7.5).
  const groups = groupQuestions(test.questions.map((q) => ({ ...q, id: q.question_id })));
  const groupOf = (position: number) => groups.find((g) => g.questions.some((q) => q.position === position)) ?? groups[0];
  /** A group is addressed by its first question's position, so the park rules work unchanged. */
  const head = (position: number | null) => (position === null ? null : (groupOf(position)?.questions[0]?.position ?? position));

  const tapePosition = head(positionAt(tape.positions, tape.positionMs));
  // "Answered" means the whole screen: the tape must not move on while half a pair is open.
  const groupAnswered = (position: number) => (groupOf(position)?.questions ?? []).every((q) => queue.answers[q.position] !== undefined);
  const shown = shownPosition(park, tapePosition, groupAnswered);
  const current = shown ?? groups[0]?.questions[0]?.position ?? 1;
  const group = groupOf(current) ?? groups[0];
  const parked = isParked(park, shown, tapePosition);
  const goTo = (position: number) => setPark({ position: head(position) ?? position, tapeWhenParked: tapePosition ?? position });
  const groupIndex = groups.findIndex((g) => g === group);
  // One passage for the whole group, drawn once above the cards (M7.21). Null for listening (the
  // stem is the transcript, withheld) and for a group of one.
  const passage = sharedStem((group?.questions ?? []).map((q) => stemView(q.stem, { hasClip: q.clip !== null })));

  const submit = (): void => {
    if (submitted.current) return;
    submitted.current = true;
    tape.stop();
    // No times reported: the server has held the clock since `/start`, and a client that was
    // reloaded part way through could only report a shorter sitting than the real one.
    finish.mutate(
      { testId: test.id, profile_id: profileId, answers: unsentAnswers(queue) },
      { onSuccess: onFinished, onError: () => (submitted.current = false) },
    );
  };

  // The end of the tape is the end of the paper.
  const finished = tape.finished;
  useEffect(() => {
    if (finished) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- submit is a one-shot guarded by a ref
  }, [finished]);

  // In-app navigation away from a sitting raises the same confirmation as the exit button. Derived
  // rather than pushed into state by an effect: the blocker already *is* the state.
  const blocker = useBlocker(() => !leaving.current && !submitted.current && !finish.isPending);
  const showExitDialog = confirmExit || blocker.state === "blocked";

  const choose = (q: TopikTestQuestion, option: number) => {
    setQueue(answerGiven(queue, q.position, option));
    // Fire and forget: a failure must not stop the tape or block the screen. Whatever is still
    // unacknowledged rides along with the submit.
    save.mutate(
      { testId: test.id, position: q.position, profile_id: profileId, selected_option: option },
      { onSuccess: () => setQueue((s) => answerAcknowledged(s, q.position, option)), onError: () => undefined },
    );
  };

  const leave = () => {
    leaving.current = true;
    tape.stop();
    // Fire and forget: the sitting is cancelled either way, and waiting on the network here would
    // only strand the learner on a screen they have already left.
    abandon.mutate({ testId: test.id, profile_id: profileId });
    if (blocker.state === "blocked") blocker.proceed();
    else void navigate("/topik/tests", { replace: true });
  };

  if (!group) return <p className="text-muted-foreground">{t("topik.test.empty")}</p>;
  const { from, to } = groupNumbers(group);
  const answered = answeredCount(queue);
  const left = clock.remainingMs;
  const mixed = test.kind === "mixed";
  // A reading paper is flipped through freely and ends by its own clock, so it gets the question
  // grid and a Submit button; the listening paper keeps exactly what it had (M7.11).
  const reading = test.section === "reading";
  const unanswered = test.question_count - answered;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium">{headerText(sittingHeader({ from, to }, { from: test.from_number, to: test.to_number }, test.question_count))}</span>
          <span className="font-mono tabular-nums text-muted-foreground">{t("topik.test.timeLeft", { time: formatRemaining(left) })}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={answered} aria-valuemax={test.question_count}>
          <div className="h-full bg-primary transition-all" style={{ width: `${progressFraction(answered, test.question_count) * 100}%` }} />
        </div>
        <span className="text-xs text-muted-foreground">{t("topik.test.answeredCount", { answered, total: test.question_count })}</span>
      </div>

      {reading && (
        <TopikTestGrid
          positions={test.questions.map((q) => q.position)}
          current={current}
          isAnswered={(position) => queue.answers[position] !== undefined}
          onJump={goTo}
        />
      )}

      {/* The clock is nearly out: a banner that stays, not a toast that flashes past — and the one
          place "+5 phút" is offered from (M7.31). */}
      {reading && clock.started && !clock.paused && isInLastMinutes(left) && <TopikTimeWarning clock={clock} />}

      {/* Which paper this question came from. Only in a mixed sitting, where it is genuinely new
          information — on an original paper it is the same label on all 50 and just noise. */}
      {mixed && (
        <p className="text-xs text-muted-foreground">
          <span lang="ko">{group.questions[0]!.exam}</span>
          {t("topik.test.sourceSeparator")}
          {from === to ? t("topik.test.itemNumber", { number: from }) : t("topik.test.groupQuestions", { from, to })}
        </p>
      )}
      {group.questions.length > 1 && (
        <p className="text-sm text-muted-foreground">{t(group.questions[0]?.clip ? "topik.test.pairNote" : "topik.test.passageNote")}</p>
      )}

      {/* Drawn once for the whole group, same reason as the practice screen (M7.21). */}
      {passage && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          {passage.image_key && <img src={imageUrl(passage.image_key)} alt="" className="w-full rounded-md object-contain" />}
          {passage.text && (
            <p className="text-lg">
              <KoreanText text={passage.text} />
            </p>
          )}
        </div>
      )}

      {group.questions.map((q) => (
        <TopikTestQuestionCard
          key={q.question_id}
          question={q}
          selected={queue.answers[q.position] ?? null}
          showNumber={group.questions.length > 1}
          hideStem={passage !== null}
          onChoose={(option) => choose(q, option)}
        />
      ))}

      <div className="flex items-center justify-between gap-2">
        {/* Flipping back through the paper is allowed in the real exam, so it is allowed here —
            the tape keeps running either way, and "Theo băng" jumps back to where it is. */}
        <Button variant="outline" onClick={() => goTo(groups[groupIndex - 1]!.questions[0]!.position)} disabled={groupIndex <= 0}>
          {t("topik.practice.prev")}
        </Button>
        {/* Always an outline button, never a ghost one: this is the way back to the paper, and on a
            phone a ghost button between two outlined ones reads as decoration. */}
        {/* Reading has no tape to follow: the grid is how you move, and there is nothing to come
            back to. */}
        {parked && !reading && (
          <Button variant="outline" onClick={() => setPark(null)}>
            {t("topik.test.followTape")}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => goTo(groups[groupIndex + 1]!.questions[0]!.position)}
          disabled={groupIndex >= groups.length - 1}
        >
          {t("topik.practice.next")}
        </Button>
      </div>

      {/* Nothing has started yet, so no exam time is passing: a slow network or an image still
          loading must not eat minutes the paper was never read in. The tape also needs a real tap —
          a phone only lets a page play audio a gesture asked for, and the second `<audio>` element
          is unlocked in that same tap. */}
      {tape.needsStart && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-accent/40 p-3">
          {reading ? (
            <>
              <p className="font-medium">{t("topik.test.readyTitle")}</p>
              <p className="text-sm">
                {t("topik.test.readyBody", { count: test.question_count, time: formatRemaining(clock.lengthMs) })}
              </p>
            </>
          ) : (
            <p className="text-sm">{t("topik.test.startNote")}</p>
          )}
          <Button type="button" onClick={tape.start}>
            {t(reading ? "topik.test.startPaper" : "topik.test.startTape")}
          </Button>
        </div>
      )}

      {/* Reopened mid-paper (M7.13). The clock never stopped, so the recording is already minutes
          in; the tap picks it up there rather than at the beginning. */}
      {tape.needsResume && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-accent/40 p-3">
          <p className="font-medium">{t("topik.test.resumeTitle")}</p>
          <p className="text-sm">
            {t("topik.test.resumeBody", { at: formatRemaining(tape.resumeAtMs), left: formatRemaining(left) })}
          </p>
          <Button type="button" onClick={tape.resume}>
            {t("topik.test.resumeTape")}
          </Button>
        </div>
      )}
      {tape.waiting && <p className="text-sm text-amber-700 dark:text-amber-500">{t("topik.test.tapeWaiting")}</p>}

      {/* Sticky, and the pause button is the full width of the row: the clock runs whatever else
          happens, so on a phone — where a child needing something is the normal interruption —
          stopping it has to be one easy thumb tap at the bottom of the screen, not a small
          secondary control among others (M7.13). */}
      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <Button
          variant={clock.paused ? "default" : "secondary"}
          className="h-14 w-full text-base"
          onClick={tape.toggle}
          disabled={!clock.started}
        >
          {clock.paused ? <Play className="size-5" aria-hidden /> : <Pause className="size-5" aria-hidden />}
          {t(clock.paused ? "topik.test.resumeClock" : "topik.test.pauseClock")}
        </Button>
        <div className="flex items-center justify-between gap-2">
          {/* Sitting at home, there is no reason to wait out the clock once the paper is done. */}
          {reading && clock.started ? (
            <Button onClick={() => setConfirmSubmit(true)} disabled={finish.isPending}>
              {t("topik.test.submit")}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="ghost" onClick={() => setConfirmExit(true)}>
            {t("topik.test.exit")}
          </Button>
        </div>
      </div>
      {clock.paused && (
        <p role="status" className="text-sm font-medium text-amber-700 dark:text-amber-500">
          {t("topik.test.pausedNow")}
        </p>
      )}
      {clock.pauseCount > 0 && <p className="text-xs text-amber-700 dark:text-amber-500">{t("topik.test.pausedNote", { count: clock.pauseCount })}</p>}
      {/* Said while the paper is still being sat, not only afterwards: the extra minutes are part
          of how this sitting went, and the result will say the same thing (M7.31). */}
      {clock.extensionCount > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-500">
          {t("topik.test.extendedNote", { minutes: Math.round(clock.extensionMs / 60_000) })}
        </p>
      )}

      {/* Folded away, but kept: if a handover ever goes wrong on a phone there are no developer
          tools to find out why, and this is the only record of what the tape actually did. */}
      {tape.log.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="min-h-11 cursor-pointer py-3">{t("topik.test.tapeLog")}</summary>
          <pre className="max-h-48 overflow-auto rounded-md border bg-muted/30 p-2 whitespace-pre-wrap">{tape.log.join("\n")}</pre>
        </details>
      )}

      <AlertDialog open={confirmSubmit} onOpenChange={(open) => !open && setConfirmSubmit(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("topik.test.submitTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {unanswered > 0 ? t("topik.test.submitUnanswered", { count: unanswered }) : t("topik.test.submitBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("topik.test.submitCancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={submit}>{t("topik.test.submitConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showExitDialog}
        onOpenChange={(open) => {
          if (open) return;
          setConfirmExit(false);
          if (blocker.state === "blocked") blocker.reset();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("topik.test.exitTitle")}</AlertDialogTitle>
            {/* The one thing that must be said out loud, now that the clock is the server's: it
                does not stop because the paper is off screen — and pausing is how to keep it. */}
            <AlertDialogDescription>{t(clock.paused ? "topik.test.exitBodyPaused" : "topik.test.exitBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("topik.test.exitStay")}</AlertDialogCancel>
            <AlertDialogAction onClick={leave}>{t("topik.test.exitLeave")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
