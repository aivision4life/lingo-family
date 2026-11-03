import { useTranslation } from "react-i18next";
import { TOPIK_OPTION_COUNT, type TopikTestQuestion } from "@shared/topik";
import { imageUrl } from "@/features/images/api";
import { cn } from "@/lib/utils";
import { allPictureOptions } from "./optionLayout";
import { TopikPictureOptions } from "./TopikPictureOptions";

/**
 * One question of a sitting (M7.5): its question line, its stem and its four options.
 *
 * A screen holds one of these, or two when a recording is followed by a pair — the real paper
 * prints those on one page, and the tape plays once, so both have to be answerable while it runs.
 * Nothing here says whether an answer is right: in a test there is no feedback until the end.
 */
export function TopikTestQuestionCard({
  question,
  selected,
  showNumber,
  onChoose,
}: {
  question: TopikTestQuestion;
  selected: number | null;
  /** A pair labels each question; a lone one is already labelled by the screen's heading. */
  showNumber: boolean;
  onChoose: (option: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className={cn("flex flex-col gap-3", showNumber && "rounded-lg border p-3")}>
      {showNumber && <p className="text-sm font-semibold">{t("topik.test.itemNumber", { number: question.number })}</p>}
      {/* Two lines since M7.3: the block instruction, then this question's own question line. */}
      {question.instruction && (
        <p className="font-medium whitespace-pre-line" lang="ko">
          {question.instruction}
        </p>
      )}
      {question.stem.image_key && <img src={imageUrl(question.stem.image_key)} alt="" className="w-full rounded-md object-contain" />}

      {allPictureOptions(question.options) ? (
        <TopikPictureOptions options={question.options} selectedOption={selected} correctOption={null} answered={false} onChoose={onChoose} />
      ) : (
        <ul className="flex flex-col gap-2">
          {Array.from({ length: TOPIK_OPTION_COUNT }, (_, i) => i + 1).map((n) => (
            <li key={n}>
              <button
                type="button"
                onClick={() => onChoose(n)}
                className={cn(
                  "flex min-h-11 w-full items-start gap-3 rounded-lg border p-3 text-left",
                  selected === n ? "border-primary bg-accent" : "hover:bg-accent",
                )}
              >
                <span className="font-medium">{n})</span>
                <span lang="ko">{question.options[n - 1]?.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
