import { Check, Circle, ZoomIn } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TopikContent } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { imageUrl } from "@/features/images/api";
import { cn } from "@/lib/utils";
import { pictureOptionState } from "./optionLayout";
import { TopikImageZoom } from "./TopikImageZoom";

/**
 * The four options of a picture question (M7.2): one big image each, numbered on the image.
 *
 * Looking and choosing are separate targets on purpose. Tapping the drawing opens it full screen,
 * because that is what someone does with a TOPIK picture — they are full of small detail and the
 * question cannot be answered without reading them. Choosing is its own button underneath, so
 * wanting a closer look can never submit an answer by accident.
 *
 * One column below 480px: a 360px phone split in two leaves ~170px per drawing, which is no more
 * readable than the thumbnail this replaced.
 */
export function TopikPictureOptions({
  options,
  selectedOption,
  correctOption,
  answered,
  onChoose,
}: {
  options: readonly TopikContent[];
  selectedOption: number | null;
  correctOption: number | null;
  answered: boolean;
  onChoose: (option: number) => void;
}) {
  const { t } = useTranslation();
  const [zoomed, setZoomed] = useState<number | null>(null);

  return (
    <>
      <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
        {options.map((opt, i) => {
          const n = i + 1;
          const isSelected = selectedOption === n;
          const isCorrect = correctOption === n;
          const state = pictureOptionState({ option: n, selected: selectedOption, correct: correctOption, answered });
          const label = t("topik.practice.optionImage", { n });
          return (
            <li
              key={n}
              className={cn(
                "flex flex-col gap-2 overflow-hidden rounded-lg border-2 p-2",
                state === "correct" && "border-green-600 bg-green-50 dark:bg-green-950/40",
                state === "wrong" && "border-destructive bg-destructive/10",
                state === "dimmed" && "border-border opacity-60",
                // Before anything is graded, a chosen option still has to *look* chosen — this is
                // the only state a mock test has and practice does not.
                state === "chosen" && "border-primary bg-accent",
                state === "idle" && "border-border",
              )}
            >
              <div className="relative">
                {/* The image is the "look closer" target, never the answer. */}
                <button
                  type="button"
                  className="block w-full cursor-zoom-in overflow-hidden rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  aria-label={t("topik.practice.zoomOpen", { n })}
                  onClick={() => setZoomed(n)}
                >
                  {/* Not lazy, unlike pictures in a list: these four *are* the question, and a
                      lazily loaded one leaves a zero-height gap exactly where the answer is. */}
                  {opt.image_key && <img src={imageUrl(opt.image_key)} alt={label} className="block h-auto w-full object-contain" />}
                </button>
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1 left-1 flex size-7 items-center justify-center rounded-full bg-foreground/85 text-sm font-semibold text-background"
                >
                  {n}
                </span>
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-1 bottom-1 flex size-7 items-center justify-center rounded-full bg-foreground/70 text-background"
                >
                  <ZoomIn className="size-4" />
                </span>
              </div>

              {answered ? (
                <p
                  className={cn(
                    "flex min-h-11 items-center justify-center gap-1.5 text-sm font-medium",
                    isCorrect ? "text-green-700 dark:text-green-400" : isSelected ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {isCorrect && <Check className="size-5 shrink-0" aria-hidden />}
                  {isCorrect ? t("topik.practice.correctOption") : isSelected ? t("topik.practice.yourOption") : t("topik.practice.optionN", { n })}
                </p>
              ) : (
                <Button
                  type="button"
                  variant={state === "chosen" ? "default" : "outline"}
                  className="w-full"
                  aria-pressed={state === "chosen"}
                  onClick={() => onChoose(n)}
                >
                  {state === "chosen" ? <Check className="size-4" aria-hidden /> : <Circle className="size-4 opacity-40" aria-hidden />}
                  {state === "chosen" ? t("topik.practice.chosenOption", { n }) : t("topik.practice.chooseOption", { n })}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {zoomed !== null && options[zoomed - 1]?.image_key && (
        <TopikImageZoom
          src={imageUrl(options[zoomed - 1]!.image_key!)}
          label={t("topik.practice.optionImage", { n: zoomed })}
          onClose={() => setZoomed(null)}
        />
      )}
    </>
  );
}
