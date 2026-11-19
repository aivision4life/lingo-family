import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Grade } from "ts-fsrs";
import type { UiLang } from "@shared/enums";
import type { PronScoreResponse } from "@shared/pron";
import { cardFieldsFromDto, type QueueItem } from "@shared/review";
import { previewIntervals } from "@shared/scheduling";
import { LinkButton } from "@/components/LinkButton";
import { FocusLayer } from "@/features/focus/FocusLayer";
import { itemsFromExamples } from "@/features/focus/focusItems";
import { useFocusRoute } from "@/features/focus/useFocusRoute";
import { Button } from "@/components/ui/button";
import { SpeedToggle } from "@/features/audio/AudioButtons";
import { playAudio } from "@/features/audio/player";
import { appNow } from "@/lib/devClock";
import { useAnswerCard } from "./api";
import { RatingButtons } from "./RatingButtons";
import { ReviewCardView } from "./ReviewCardView";
import { SpeakingPrompt } from "./SpeakingPrompt";
import { autoPlaysOnFront } from "./cardFace";
import { usePreload } from "./preload";
import { afterAnswer, currentItem, flip, isFinished, skipCard, startSession } from "./session";

type Props = { profileId: string; glossLang: UiLang; items: QueueItem[] };

export function ReviewSession({ profileId, glossLang, items }: Props) {
  const { t } = useTranslation();
  const [session, setSession] = useState(() => startSession(items));
  const answer = useAnswerCard();
  // Speaking cards (M3.3): the takes scored on the card being shown. Only their ids are sent —
  // the server reads back its own scores and states the rating. Kept with the card they belong to
  // instead of being cleared in an effect, so the next card simply starts with none.
  const [scored, setScored] = useState<{ card: string; takes: PronScoreResponse[] }>({ card: "", takes: [] });
  // Set when each card is shown (in the effect below), used for duration_ms.
  const shownAt = useRef(0);
  const item = currentItem(session);
  // Enlarging an example (M2.5) only looks: it never flips or rates the card. The view lives in the
  // URL (?focus=...), and this component keeps its state while the parameter changes.
  const focusItems = item ? itemsFromExamples(item.examples, item.word.lang, item.word.emoji) : [];
  const focus = useFocusRoute(focusItems);
  const focusOpen = focus.activeIndex >= 0;

  // Each new front: restart the timer and auto-play its audio (the user already tapped "Start").
  const cardKey = item ? `${session.pos}:${item.card.id}` : null;
  useEffect(() => {
    if (!item) return;
    shownAt.current = Date.now();
    if (item.word.audio_key && autoPlaysOnFront(item.card.card_type)) playAudio(item.word.audio_key);
    // Only when the shown card changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey]);

  // Picture cards are silent on the front (the sound would give the word away): play on the flip.
  useEffect(() => {
    if (item && session.flipped && !autoPlaysOnFront(item.card.card_type) && item.word.audio_key) playAudio(item.word.audio_key);
    // Only when the card is flipped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.flipped]);

  usePreload(session.queue, session.pos);

  /**
   * One answer. `rating` is the learner's own choice; without it the server grades the speaking
   * takes itself. `counted: false` means nothing was reviewed (no take could be scored): the card
   * is left alone and the session simply moves past it — never an Again it did not earn.
   */
  const send = (body: { rating?: Grade; attempt_ids?: string[] }) => {
    if (!item || answer.isPending) return;
    answer.mutate(
      { profile_id: profileId, card_id: item.card.id, duration_ms: Date.now() - shownAt.current, ...body },
      { onSuccess: ({ card, counted }) => setSession((s) => (counted ? afterAnswer(s, card, appNow()) : skipCard(s))) },
    );
  };

  const rate = (grade: Grade) => {
    if (!session.flipped) return;
    send({ rating: grade });
  };

  // Keyboard: Space flips, 1–4 rate (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (focusOpen) return; // the Focus view has the keyboard (←/→ there; Space and 1–4 do nothing)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        setSession(flip);
      } else if (["1", "2", "3", "4"].includes(e.key)) {
        rate(Number(e.key) as Grade);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (isFinished(session)) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-2xl font-semibold">{t("review.done", { count: session.answered })}</p>
        <LinkButton to="/home" size="lg">
          {t("review.backHome")}
        </LinkButton>
      </div>
    );
  }
  if (!item) return null;

  const progress = Math.round((session.pos / session.queue.length) * 100);
  const isSpeaking = item.card.card_type === "speaking";
  const takes = scored.card === cardKey ? scored.takes : [];
  return (
    <FocusLayer items={focusItems} route={focus} glossLang={glossLang}>
    <div className={`flex flex-col gap-4 ${isSpeaking ? "pb-52" : "pb-32"}`}>
      <div className="flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={session.queue.length}
          aria-valuenow={session.pos}
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-sm text-muted-foreground">
          {t("review.progress", { done: session.pos, total: session.queue.length })}
        </span>
        <SpeedToggle />
      </div>

      <ReviewCardView item={item} flipped={session.flipped} glossLang={glossLang} />

      {isSpeaking && (
        <SpeakingPrompt
          // A new card starts with a fresh recorder: no leftover score, no spent takes.
          key={cardKey}
          item={item}
          profileId={profileId}
          onScored={(result) => {
            setScored((previous) => ({
              card: cardKey!,
              takes: previous.card === cardKey ? [...previous.takes, result] : [result],
            }));
            setSession(flip); // the score is in: show the meaning and the rating bar
          }}
        />
      )}

      {/* Fixed to the bottom so the thumb always reaches the buttons, however long the back is. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur">
        <div className="mx-auto w-full max-w-4xl">
          {session.flipped ? (
            <div className="flex flex-col gap-2">
              {isSpeaking &&
                (takes.length > 0 ? (
                  <Button
                    size="lg"
                    className="min-h-14 w-full text-lg"
                    disabled={answer.isPending}
                    onClick={() => send({ attempt_ids: takes.map((take) => take.attempt_id) })}
                  >
                    {t("review.speaking.continue", { score: Math.round(Math.max(...takes.map((take) => take.pron_score))) })}
                  </Button>
                ) : (
                  <Button variant="outline" size="lg" className="min-h-14 w-full text-lg" onClick={() => setSession(skipCard)}>
                    {t("review.speaking.skip")}
                  </Button>
                ))}
              <RatingButtons
                intervals={previewIntervals(cardFieldsFromDto(item.card), appNow())}
                disabled={answer.isPending}
                onRate={rate}
              />
            </div>
          ) : (
            <Button size="lg" className="min-h-16 w-full text-lg" onClick={() => setSession(flip)}>
              {t("review.showAnswer")}
            </Button>
          )}
        </div>
      </div>
      {isSpeaking && takes.length === 0 && (
        <p className="text-center text-xs text-muted-foreground">{t("review.speaking.notCounted")}</p>
      )}
      {answer.isError && <p role="alert" className="text-sm text-destructive">{t("review.saveError")}</p>}
      <p className="hidden text-center text-xs text-muted-foreground md:block">{t("review.shortcuts")}</p>
    </div>
    </FocusLayer>
  );
}
