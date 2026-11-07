import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TopikSection } from "@shared/enums";
import { formatRemaining } from "./testClock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTopikRangePreview } from "./api";

/**
 * Choosing which questions to sit (M7.14).
 *
 * The three shortcut buttons above this are for sitting a paper; this is for drilling one kind of
 * question — "câu 16 đến 18" — which is most of what practice actually is. It says what the range
 * would really be *before* committing to it: the server widens a range that would cut a pair in
 * half, and refuses one with a hole in it, and this shows both while the numbers are being typed.
 *
 * The preview is read-only on the server, so asking on every keystroke costs nothing but a SELECT.
 */
export function TestRangePicker({
  profileId,
  section,
  kind,
  exam,
  maxNumber,
  pending,
  onStart,
}: {
  profileId: string;
  section: TopikSection;
  kind: "original" | "mixed";
  /** Null for the mixed card, which has no paper of its own. */
  exam: string | null;
  /** What the paper (or the bank) can reach, used only as the inputs' upper bound. */
  maxNumber: number;
  pending: boolean;
  onStart: (range: { from: number; to: number }) => void;
}) {
  const { t } = useTranslation();
  // Kept as text: a half-typed number must not jump about under the thumb.
  const [fromText, setFromText] = useState("1");
  const [toText, setToText] = useState(String(Math.max(1, maxNumber)));
  const from = Number(fromText);
  const to = Number(toText);
  const valid = Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from;

  const preview = useTopikRangePreview(profileId, section, kind, exam, valid ? from : 0, valid ? to : 0);
  const ready = preview.data && preview.data.missing_number === null;
  const groupWord = t(section === "listening" ? "topik.test.rangeGroupClip" : "topik.test.rangeGroupPassage");

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <span className="text-sm font-medium">{t("topik.test.rangeTitle")}</span>
      {/* Two 110px fields plus the arrow fit inside 360px with the card's own padding. */}
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`from-${kind}-${exam ?? "mixed"}`}>
          {t("topik.test.rangeFrom")}
        </label>
        <Input
          id={`from-${kind}-${exam ?? "mixed"}`}
          type="number"
          inputMode="numeric"
          min={1}
          max={maxNumber}
          className="h-11 w-[6.5rem]"
          value={fromText}
          onChange={(e) => setFromText(e.target.value)}
        />
        <span aria-hidden className="text-muted-foreground">
          →
        </span>
        <label className="sr-only" htmlFor={`to-${kind}-${exam ?? "mixed"}`}>
          {t("topik.test.rangeTo")}
        </label>
        <Input
          id={`to-${kind}-${exam ?? "mixed"}`}
          type="number"
          inputMode="numeric"
          min={1}
          max={maxNumber}
          className="h-11 w-[6.5rem]"
          value={toText}
          onChange={(e) => setToText(e.target.value)}
        />
      </div>

      {/* One status line, three things it can say. */}
      <p className={`text-sm ${preview.data?.missing_number ? "text-destructive" : "text-muted-foreground"}`} role="status">
        {!valid
          ? t("topik.test.rangeInvalid")
          : preview.isPending
            ? t("common.loading")
            : preview.isError
              ? t("common.loadError")
              : preview.data.missing_number !== null
                ? t("topik.test.rangeMissing", { number: preview.data.missing_number })
                : [
                    t("topik.test.rangeSummary", {
                      from: preview.data.from,
                      to: preview.data.to,
                      count: preview.data.question_count,
                      time: formatRemaining(preview.data.length_ms),
                    }),
                    preview.data.expanded
                      ? t("topik.test.rangeExpanded", {
                          from: preview.data.from,
                          to: preview.data.to,
                          added: preview.data.added.join(", "),
                          group: groupWord,
                        })
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
      </p>

      <Button
        type="button"
        disabled={!ready || pending}
        // The widened range, not the typed one: what is started is what the line above promises.
        onClick={() => preview.data && onStart({ from: preview.data.from, to: preview.data.to })}
      >
        {t("topik.test.startRange")}
      </Button>
    </div>
  );
}
