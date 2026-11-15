import { useTranslation } from "react-i18next";
import { TOPIK_OPTION_COUNT, type TopikTestQuestion } from "@shared/topik";
import { imageUrl } from "@/features/images/api";
import { cn } from "@/lib/utils";
import { KoreanText } from "./KoreanText";
import { allPictureOptions } from "./optionLayout";
import { ownStemBesideShared, stemView } from "./questionStem";
import { TopikPictureOptions } from "./TopikPictureOptions";
import { TopikPriorBadge } from "./TopikPriorBadge";

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
  hideStem = false,
  onChoose,
}: {
  question: TopikTestQuestion;
  selected: number | null;
  /** A pair labels each question; a lone one is already labelled by the screen's heading. */
  showNumber: boolean;
  /** The screen already drew this stem above the whole group (`sharedStem`, M7.21). */
  hideStem?: boolean;
  onChoose: (option: number) => void;
}) {
  const { t } = useTranslation();
  // The passage is drawn once above the group (M7.21); a boxed sentence belongs to this question
  // alone and stays here (M7.23).
  const own = stemView(question.stem, { hasClip: question.clip !== null });
  const stem = hideStem ? ownStemBesideShared(own) : own;

  return (
    <div className={cn("flex flex-col gap-3", showNumber && "rounded-lg border p-3")}>
      {/* "Câu mới" / "2/4" as it stood when the paper started (M7.30). Above the question line and
          muted: during a listening sitting the tape is running, and nothing here may cover the
          question or move the options. The number never changes while the paper is being sat, which
          is the point — one that moved would say an answer had just been right. */}
      <div className="flex flex-wrap items-baseline gap-x-2">
        {showNumber && <p className="text-sm font-semibold">{t("topik.test.itemNumber", { number: question.number })}</p>}
        <TopikPriorBadge prior={question.prior} />
      </div>
      {/* Two lines since M7.3: the block instruction, then this question's own question line. */}
      {question.instruction && (
        <p className="font-bold whitespace-pre-line" lang="ko">
          {question.instruction}
        </p>
      )}
      {/* A reading question's stem *is* the question — the passage, the notice, the sentence with
          the gap — so it is shown from the start. A listening stem is the transcript and the server
          sends null for it during a sitting, which is why this block only ever appears for reading
          (M7.11: it was missing, and a reading sitting showed four options and nothing to read). */}
      {stem && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          {stem.image_key && <img src={imageUrl(stem.image_key)} alt="" className="w-full rounded-md object-contain" />}
          {stem.text && (
            <p className="text-lg">
              <KoreanText text={stem.text} />
            </p>
          )}
        </div>
      )}

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
