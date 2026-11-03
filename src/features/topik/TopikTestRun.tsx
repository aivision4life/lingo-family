import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker, useNavigate } from "react-router";
import { TOPIK_OPTION_COUNT, type TopikTestResult, type TopikTestRun } from "@shared/topik";
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
import { Button } from "@/components/ui/button";
import { imageUrl } from "@/features/images/api";
import { useAbandonTopikTest, useFinishTopikTest, useSaveTopikTestAnswer } from "./api";
import { answerAcknowledged, answerGiven, answeredCount, emptyQueue, unsentAnswers, type AnswerQueue } from "./answerQueue";
import { allPictureOptions } from "./optionLayout";
import { formatRemaining, isParked, positionAt, progressFraction, remainingMs, shownPosition, type ParkedAt } from "./testClock";
import { TopikPictureOptions } from "./TopikPictureOptions";
import { useSittingTape } from "./useSittingTape";
import { cn } from "@/lib/utils";

/** Outside the component so `react-hooks/purity` does not flag the clock read itself. */
const nowMs = () => Date.now();

/**
 * Sitting a mock test (M6.4). The tape is the clock: it runs from the first clip's start to the
 * last clip's end, answering silences included, and which question is "current" follows the
 * playing head. There is no replay, no speed control and no seeking — that is the exercise.
 *
 * Going back to change an earlier answer *is* allowed while the tape runs, because flipping back a
 * page is allowed in the real exam.
 */
export function TopikTestRun({ test, profileId, onFinished }: { test: TopikTestRun; profileId: string; onFinished: (r: TopikTestResult) => void }) {
  const { t } = useTranslation();
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
  const submitted = useRef(false);
  /** Set the moment the learner confirms leaving, so the blocker stops blocking that very exit. */
  const leaving = useRef(false);
  // Set on the first effect run rather than during render: `react-hooks/purity` refuses a clock
  // read while rendering, and the sitting starts when the tape does anyway.
  const startedAt = useRef(0);
  useEffect(() => {
    startedAt.current = nowMs();
  }, []);

  const tape = useSittingTape(test);
  const tapePosition = positionAt(tape.positions, tape.positionMs);
  const shown = shownPosition(park, tapePosition, (position) => queue.answers[position] !== undefined);
  const current = shown ?? test.questions[0]?.position ?? 1;
  const question = test.questions.find((q) => q.position === current) ?? test.questions[0];
  const parked = isParked(park, shown, tapePosition);
  const goTo = (position: number) => setPark({ position, tapeWhenParked: tapePosition ?? position });

  const submit = (): void => {
    if (submitted.current) return;
    submitted.current = true;
    tape.stop();
    finish.mutate(
      {
        testId: test.id,
        profile_id: profileId,
        duration_ms: nowMs() - startedAt.current,
        pause_count: tape.pauseCount,
        paused_ms: tape.pausedMs,
        answers: unsentAnswers(queue),
      },
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

  const choose = (option: number) => {
    const next = answerGiven(queue, question!.position, option);
    setQueue(next);
    // Fire and forget: a failure must not stop the tape or block the screen. Whatever is still
    // unacknowledged rides along with the submit.
    save.mutate(
      { testId: test.id, position: question!.position, profile_id: profileId, selected_option: option },
      { onSuccess: () => setQueue((q) => answerAcknowledged(q, question!.position, option)), onError: () => undefined },
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

  if (!question) return <p className="text-muted-foreground">{t("topik.test.empty")}</p>;
  const answered = answeredCount(queue);
  const left = remainingMs(tape.positionMs, tape.endMs);
  const mixed = test.kind === "mixed";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium">{t("topik.test.atQuestion", { number: question.number, total: test.question_count })}</span>
          <span className="font-mono tabular-nums text-muted-foreground">{t("topik.test.timeLeft", { time: formatRemaining(left) })}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={answered} aria-valuemax={test.question_count}>
          <div className="h-full bg-primary transition-all" style={{ width: `${progressFraction(answered, test.question_count) * 100}%` }} />
        </div>
        <span className="text-xs text-muted-foreground">{t("topik.test.answeredCount", { answered, total: test.question_count })}</span>
      </div>

      {/* Which paper this question came from. Only in a mixed sitting, where it is genuinely new
          information — on an original paper it is the same label on all 50 and just noise. */}
      {mixed && (
        <p className="text-xs text-muted-foreground">
          <span lang="ko">{question.exam}</span>
          {t("topik.test.sourceSeparator")}
          {t("topik.test.itemNumber", { number: question.number })}
        </p>
      )}

      {/* Two lines since M7.3: the block instruction, then this question's own question line. */}
      {question.instruction && (
        <p className="font-medium whitespace-pre-line" lang="ko">
          {question.instruction}
        </p>
      )}
      {question.stem.image_key && <img src={imageUrl(question.stem.image_key)} alt="" className="w-full rounded-md object-contain" />}

      {allPictureOptions(question.options) ? (
        <TopikPictureOptions
          options={question.options}
          selectedOption={queue.answers[question.position] ?? null}
          correctOption={null}
          answered={false}
          onChoose={choose}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {Array.from({ length: TOPIK_OPTION_COUNT }, (_, i) => i + 1).map((n) => {
            const selected = queue.answers[question.position] === n;
            return (
              <li key={n}>
                <button
                  type="button"
                  onClick={() => choose(n)}
                  className={cn(
                    "flex min-h-11 w-full items-start gap-3 rounded-lg border p-3 text-left",
                    selected ? "border-primary bg-accent" : "hover:bg-accent",
                  )}
                >
                  <span className="font-medium">{n})</span>
                  <span lang="ko">{question.options[n - 1]?.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2">
        {/* Flipping back through the paper is allowed in the real exam, so it is allowed here —
            the tape keeps running either way, and "Theo băng" jumps back to where it is. */}
        <Button variant="outline" onClick={() => goTo(Math.max(1, current - 1))} disabled={current <= 1}>
          {t("topik.practice.prev")}
        </Button>
        {/* Always an outline button, never a ghost one: this is the way back to the paper, and on a
            phone a ghost button between two outlined ones reads as decoration. */}
        {parked && (
          <Button variant="outline" onClick={() => setPark(null)}>
            {t("topik.test.followTape")}
          </Button>
        )}
        <Button variant="outline" onClick={() => goTo(Math.min(test.question_count, current + 1))} disabled={current >= test.question_count}>
          {t("topik.practice.next")}
        </Button>
      </div>

      {/* The mixed tape must be started by a tap: a phone only lets a page play audio an actual
          gesture asked for, and the second `<audio>` element is unlocked in that same tap. */}
      {tape.needsStart && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-accent/40 p-3">
          <p className="text-sm">{t("topik.test.startNote")}</p>
          <Button type="button" onClick={tape.start}>
            {t("topik.test.startTape")}
          </Button>
        </div>
      )}
      {tape.waiting && <p className="text-sm text-amber-700 dark:text-amber-500">{t("topik.test.tapeWaiting")}</p>}

      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <Button variant="secondary" onClick={tape.toggle} disabled={tape.needsStart}>
          {tape.playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          {t(tape.playing ? "topik.test.pause" : "topik.test.resume")}
        </Button>
        <Button variant="ghost" onClick={() => setConfirmExit(true)}>
          {t("topik.test.exit")}
        </Button>
      </div>
      {tape.pauseCount > 0 && <p className="text-xs text-amber-700 dark:text-amber-500">{t("topik.test.pausedNote", { count: tape.pauseCount })}</p>}

      {/* Folded away, but kept: if a handover ever goes wrong on a phone there are no developer
          tools to find out why, and this is the only record of what the tape actually did. */}
      {tape.log.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="min-h-11 cursor-pointer py-3">{t("topik.test.tapeLog")}</summary>
          <pre className="max-h-48 overflow-auto rounded-md border bg-muted/30 p-2 whitespace-pre-wrap">{tape.log.join("\n")}</pre>
        </details>
      )}

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
            <AlertDialogDescription>{t("topik.test.exitBody")}</AlertDialogDescription>
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
