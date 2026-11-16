import { ChevronLeft, ChevronRight, Repeat, Volume2, VolumeOff, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UiLang } from "@shared/enums";
import { LangText } from "@/components/LangText";
import { Button } from "@/components/ui/button";
import { SpeedToggle } from "@/features/audio/AudioButtons";
import { mediaUrl, playAudio, stopAudio } from "@/features/audio/player";
import { imageUrl } from "@/features/images/api";
import { ItemImage } from "@/features/images/ItemImage";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { RecordScore } from "@/features/pron/RecordScore";
import { warm } from "@/features/review/preload";
import { cn } from "@/lib/utils";
import { setAutoplay, useAutoplay } from "./autoplay";
import { orderedTranslations, stepIndex, swipeDirection, type FocusItem } from "./focusItems";
import { useRepeat } from "./useRepeat";

type Props = {
  items: FocusItem[];
  index: number;
  glossLang: UiLang;
  onChange: (key: string) => void;
  onClose: () => void;
};

/** Neighbouring items' pictures and sounds, so moving to them is instant. */
function warmNeighbours(items: FocusItem[], index: number) {
  const near = [items[index - 1], items[index + 1]].filter((i): i is FocusItem => !!i);
  warm(
    {
      images: near.flatMap((i) => (i.image.image_key ? [imageUrl(i.image.image_key)] : [])),
      audio: near.flatMap((i) => (i.audio_key ? [mediaUrl(i.audio_key)] : [])),
    },
    true,
  );
}

/**
 * Full-screen "Focus view" of an example sentence or phrase (M2.5): big picture, big text, the
 * meaning hidden until tapped, listen / speed / repeat, swipe or ←/→ to move, Esc or ✕ to close.
 * It is a Radix dialog, so scrolling behind it is locked and focus stays inside.
 */
export function FocusView({ items, index, glossLang, onChange, onClose }: Props) {
  const { t } = useTranslation();
  const item = items[index]!;
  const { profile } = useActiveProfile();
  const autoplay = useAutoplay();
  const repeat = useRepeat(item.audio_key);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const revealed = revealedKey === item.key; // the meaning hides again on every new item

  const go = (delta: -1 | 1) => {
    const next = items[stepIndex(index, delta, items.length)];
    if (next && next.key !== item.key) onChange(next.key);
  };

  // A new item: play it when auto-play is on (the setting itself does not trigger a play).
  useEffect(() => {
    if (autoplay && item.audio_key) playAudio(item.audio_key);
    warmNeighbours(items, index);
    // Only when the shown item changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.key]);
  // Closing (unmount) silences the sound.
  useEffect(() => stopAudio, []);

  const translations = orderedTranslations(item.translations, glossLang);
  const total = items.length;

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          data-focus-view
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") go(-1);
            else if (e.key === "ArrowRight") go(1);
          }}
          className="fixed inset-0 z-[60] flex flex-col bg-background pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] outline-none"
        >
          <DialogPrimitive.Title className="sr-only">{t("focus.dialogTitle")}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{t("focus.dialogDescription")}</DialogPrimitive.Description>

          <div className="flex items-center justify-between gap-2">
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="icon" aria-label={t("focus.close")}>
                <X className="size-6" aria-hidden />
              </Button>
            </DialogPrimitive.Close>
            <div className="flex flex-col items-center gap-1">
              <span className="text-xs text-muted-foreground">
                {t(`focus.kind.${item.kind}`)} · {t("focus.position", { current: index + 1, total })}
              </span>
              <span className="flex gap-1.5" aria-hidden>
                {items.map((i, n) => (
                  <span key={i.key} className={cn("size-2 rounded-full", n === index ? "bg-primary" : "bg-muted-foreground/30")} />
                ))}
              </span>
            </div>
            <span className="size-11" aria-hidden />
          </div>

          {/* Swipe area: a long horizontal move changes item; vertical moves still scroll. */}
          <div
            className="flex min-h-0 flex-1 touch-pan-y flex-col items-center gap-4 overflow-y-auto py-3"
            onPointerDown={(e) => (swipeStart.current = { x: e.clientX, y: e.clientY })}
            onPointerUp={(e) => {
              const start = swipeStart.current;
              swipeStart.current = null;
              if (!start) return;
              const dir = swipeDirection(e.clientX - start.x, e.clientY - start.y);
              if (dir !== 0) go(dir);
            }}
            onPointerCancel={() => (swipeStart.current = null)}
          >
            <ItemImage
              key={item.key}
              kind={item.kind}
              id={item.id}
              image={item.image}
              alt={item.text}
              emoji={item.emoji}
              size="large"
              lazy
              className="w-[min(100%,42dvh)] max-w-none shrink-0 sm:w-[min(100%,26rem,42dvh)]"
            />
            <div className="flex w-full flex-col items-center gap-2 px-2 text-center">
              <LangText lang={item.lang} className="text-4xl leading-snug font-bold break-words sm:text-5xl">
                {item.text}
              </LangText>
              {item.reading && <span className="text-xl text-muted-foreground">{item.reading}</span>}
            </div>
            <button
              type="button"
              aria-expanded={revealed}
              onClick={() => setRevealedKey(revealed ? null : item.key)}
              className="min-h-14 w-full max-w-md rounded-xl border border-dashed px-4 py-3 text-center outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {revealed && translations.length > 0 ? (
                <span className="flex flex-col gap-1">
                  {translations.map(({ lang, text }, n) => (
                    <span key={lang} lang={lang} className={n === 0 ? "text-xl font-semibold" : "text-base text-muted-foreground"}>
                      {text}
                    </span>
                  ))}
                  <span className="sr-only">{t("focus.hideTranslation")}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">{t("focus.showTranslation")}</span>
              )}
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-center gap-3">
              <Button type="button" variant="outline" size="icon-lg" aria-label={t("focus.previous")} disabled={index === 0} onClick={() => go(-1)}>
                <ChevronLeft className="size-6" aria-hidden />
              </Button>
              <Button
                type="button"
                size="lg"
                className="min-h-14 flex-1 text-lg"
                disabled={!item.audio_key}
                onClick={() => item.audio_key && playAudio(item.audio_key)}
              >
                <Volume2 className="size-6" aria-hidden />
                {item.audio_key ? t("focus.listen") : t("focus.noAudio")}
              </Button>
              <Button type="button" variant="outline" size="icon-lg" aria-label={t("focus.next")} disabled={index === total - 1} onClick={() => go(1)}>
                <ChevronRight className="size-6" aria-hidden />
              </Button>
            </div>
            <div className="flex items-center justify-center gap-2">
              <SpeedToggle />
              <Button type="button" variant={repeat.repeating ? "default" : "outline"} aria-pressed={repeat.repeating} disabled={!item.audio_key} onClick={repeat.toggle}>
                <Repeat aria-hidden />
                {repeat.repeating ? t("focus.repeatStop") : t("focus.repeat")}
              </Button>
              <Button type="button" variant="outline" aria-pressed={autoplay} title={t("focus.autoplayHint")} onClick={() => setAutoplay(!autoplay)}>
                {autoplay ? <Volume2 aria-hidden /> : <VolumeOff aria-hidden />}
                {autoplay ? t("focus.autoplayOn") : t("focus.autoplayOff")}
              </Button>
            </div>
            {/* Record & score (M3.2). Kid profiles included: the server gives them a smaller quota. */}
            <section data-slot="focus-record" aria-label={t("focus.record")}>
              {profile && <RecordScore key={item.key} target={{ kind: item.kind, id: item.id }} lang={item.lang} text={item.text} profileId={profile.id} />}
            </section>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
