import { splitUnderline } from "@shared/topik";

/**
 * Korean text with its line breaks kept and any `<u>…</u>`-marked phrase shown bold+underlined
 * (문항 3-4 asks about exactly that phrase, so it must stay visible while reading). Built as React
 * elements from parsed data — never `dangerouslySetInnerHTML`; `<보기>` and friends stay literal.
 *
 * Shared by every screen that shows a question's own text without making words tappable: the
 * read-only review view (M6.7) and a sitting (M7.11). Practice uses `TappableText` instead, which
 * adds the word popovers on top of the same `splitUnderline` runs.
 */
export function KoreanText({ text }: { text: string }) {
  return (
    <span lang="ko" className="whitespace-pre-wrap">
      {splitUnderline(text).map((run, i) =>
        run.underlined ? (
          <strong key={i} className="underline">
            {run.text}
          </strong>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </span>
  );
}
