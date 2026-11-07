import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import {
  TOPIK_OPTION_COUNT,
  type TopikPracticeQuestion,
  type TopikRevealEntry,
  type TopikVocabEntry,
} from "@shared/topik";
import { imageUrl } from "@/features/images/api";
import { cn } from "@/lib/utils";
import { stemView } from "./questionStem";
import { allPictureOptions } from "./optionLayout";
import { TopikPictureOptions } from "./TopikPictureOptions";
import { useTopikQuestionContent, useTopikQuestionStats } from "./api";
import { MarkSourceContext } from "./markSource";
import { TopikExplanation } from "./TopikExplanation";
import type { QuestionState } from "./sessionState";
import { TopikWordTap } from "./TopikWordPopover";
import { segmentTextWithUnderline } from "./vocabSegments";

/**
 * One question of a practice screen (M7.5): its own question line, its four options, its verdict
 * and its explanation.
 *
 * A screen holds one of these, or two when a recording is followed by a pair — which is why this
 * is a component rather than part of `TopikSession`. The clip is deliberately **not** here: a pair
 * shares one recording and one player, and that belongs to the screen above both cards.
 */
export function TopikQuestionCard({
  question,
  profileId,
  state,
  reveal,
  showNumber,
  onChoose,
}: {
  question: TopikPracticeQuestion;
  profileId: string;
  state: QuestionState | undefined;
  /** Set once the whole group may be read: every question answered, or the group given up on. */
  reveal: TopikRevealEntry | null;
  /** A pair labels each card; a lone question is already labelled by the screen's own heading. */
  showNumber: boolean;
  onChoose: (option: number) => void;
}) {
  const { t } = useTranslation();
  const answered = state?.kind === "answered" ? state : null;
  const givenUp = state?.kind === "given_up";
  const selectedOption = answered?.selected ?? null;

  // The explanation may still be generating when the group is revealed; poll until it lands.
  const explainPoll = useTopikQuestionContent(
    question.id,
    profileId,
    reveal !== null && !reveal.explain_ready,
  );
  const explanation =
    reveal && !reveal.explain_ready && explainPoll.data?.explain_ready
      ? {
          ...reveal,
          explanation_vi: explainPoll.data.explanation_vi,
          key_terms: explainPoll.data.key_terms,
          explain_ready: true,
        }
      : reveal;

  // Same for the tappable words, which are what makes a question readable before it is answered.
  const vocabPoll = useTopikQuestionContent(
    question.id,
    profileId,
    !question.vocab_ready,
  );
  const vocab =
    !question.vocab_ready && vocabPoll.data?.vocab_ready
      ? vocabPoll.data.vocab
      : question.vocab;

  const stats = useTopikQuestionStats(question.id, profileId);
  // This question's own verdict, which may be shown while a sibling is still unanswered: knowing
  // question 21 was wrong says nothing about what question 22 asks.
  const correctOption =
    answered?.result.correct_option ?? reveal?.correct_option ?? null;
  const locked = answered !== null || givenUp;
  const stem = stemView(question.stem, { hasClip: question.audio !== null });

  return (
    // Everything marked on this card — a tapped word in the text, a key term under the explanation
    // — is marked as met in *this* question, which is what decides its album later (M7.12).
    <MarkSourceContext.Provider
      value={{
        section: question.section,
        exam: question.exam,
        number: question.number,
      }}
    >
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        {showNumber && (
          <p className="text-sm font-semibold">
            {t("topik.practice.examQuestion", {
              exam: question.exam,
              number: question.number,
            })}
          </p>
        )}
        {question.instruction && (
          <p className="font-bold whitespace-pre-line">
            <TappableText text={question.instruction} vocab={vocab} />
          </p>
        )}
        {/* A listening question's stem is its transcript and is withheld; its clip is on the screen
          above. Everything else reads its stem here as usual (`stemView`). */}
        {stem && (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            {stem.image_key && (
              <img
                src={imageUrl(stem.image_key)}
                alt=""
                className="w-full rounded-md object-contain"
              />
            )}
            {stem.text && (
              <p className="text-lg">
                <TappableText text={stem.text} vocab={vocab} />
              </p>
            )}
          </div>
        )}

        {allPictureOptions(question.options) ? (
          <TopikPictureOptions
            options={question.options}
            selectedOption={selectedOption}
            correctOption={correctOption}
            answered={locked}
            onChoose={onChoose}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {Array.from({ length: TOPIK_OPTION_COUNT }, (_, i) => i + 1).map(
              (n) => {
                const opt = question.options[n - 1]!;
                const isSelected = selectedOption === n;
                const isCorrectOpt = correctOption === n;
                return (
                  // A tappable word inside the option text is itself a <button>, so this cannot be one
                  // too (nested interactive elements); its click stops at any inner word tap.
                  <div
                    key={n}
                    role="button"
                    tabIndex={locked ? -1 : 0}
                    aria-disabled={locked}
                    onClick={() => !locked && onChoose(n)}
                    onKeyDown={(e) => {
                      if (!locked && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        onChoose(n);
                      }
                    }}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      correctOption !== null
                        ? isCorrectOpt
                          ? "border-green-600 bg-green-50 dark:bg-green-950/40"
                          : isSelected
                            ? "border-destructive bg-destructive/10"
                            : "opacity-60"
                        : "hover:bg-accent",
                    )}
                  >
                    <span className="font-medium">{n})</span>
                    {opt.image_key && (
                      <img
                        src={imageUrl(opt.image_key)}
                        alt=""
                        className="h-16 w-16 rounded object-cover"
                      />
                    )}
                    {opt.text && <TappableText text={opt.text} vocab={vocab} />}
                  </div>
                );
              },
            )}
          </div>
        )}

        {answered && (
          <p
            className={
              answered.result.is_correct
                ? "text-green-700 dark:text-green-400"
                : "text-destructive"
            }
          >
            {answered.result.is_correct
              ? t("topik.practice.correct")
              : t("topik.practice.incorrect")}
          </p>
        )}
        {givenUp && (
          <p className="text-sm text-muted-foreground">
            {t("topik.practice.givenUp")}
          </p>
        )}

        {explanation && (
          <TopikExplanation
            explanation_vi={explanation.explanation_vi}
            key_terms={explanation.key_terms}
            ready={explanation.explain_ready}
            autoShow={answered === null || !answered.result.is_correct}
          />
        )}
        <p className="text-xs text-muted-foreground">
          {stats.data
            ? stats.data.attempts > 0
              ? t("topik.practice.personalStats", {
                  correct: stats.data.correct,
                  attempts: stats.data.attempts,
                })
              : t("topik.practice.personalStatsNone")
            : " "}
        </p>
      </div>
    </MarkSourceContext.Provider>
  );
}

/**
 * Renders `text` with its AI-found words tappable (M6.2) and any `<u>…</u>`-marked phrase
 * bold+underlined: read-only, nothing is marked by default. Built as React elements (never
 * `dangerouslySetInnerHTML`) — the markup is parsed into plain data before any rendering happens.
 */
export function TappableText({
  text,
  vocab,
}: {
  text: string;
  vocab: TopikVocabEntry[];
}) {
  return (
    <span lang="ko" className="whitespace-pre-wrap">
      {segmentTextWithUnderline(text, vocab).map((seg, i) => {
        const content = seg.entry ? (
          <TopikWordTap entry={seg.entry} />
        ) : (
          seg.text
        );
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
