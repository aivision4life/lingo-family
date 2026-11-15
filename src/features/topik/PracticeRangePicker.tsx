import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TopikSection } from "@shared/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTopikPracticeRange } from "./api";

/**
 * Practising a range of question numbers the learner typed, rather than a listed block (M7.24).
 *
 * The blocks above this are the paper's own divisions; this is for drilling one kind of question —
 * "câu 16 đến 18" — usually gathered from **every** paper at once, which is what makes it worth
 * having next to them. It says what the range would really be before committing to it, because two
 * things can surprise: the range is widened to whole groups (asking for 19 gets 19-20, since they
 * share a passage), and one paper may simply not have those numbers typed up yet.
 *
 * Sibling of `TestRangePicker`, deliberately not the same component: that one starts a timed
 * sitting and refuses a range with a hole; this one starts practice and a hole is normal — see
 * `GET /topik/practice-range` for why those two rules cannot be shared.
 */
export function PracticeRangePicker({
  profileId,
  section,
  exam,
  maxNumber,
  onStart,
}: {
  profileId: string;
  section: TopikSection;
  /** Null = every paper. */
  exam: string | null;
  /** Upper bound for the inputs only. */
  maxNumber: number;
  onStart: (range: { from: number; to: number }) => void;
}) {
  const { t } = useTranslation();
  // Kept as text so a half-typed number does not jump about under the thumb (same as the sitting
  // picker, same reason).
  const [fromText, setFromText] = useState("1");
  const [toText, setToText] = useState(String(Math.max(1, maxNumber)));
  const from = Number(fromText);
  const to = Number(toText);
  const valid = Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from;
  const preview = useTopikPracticeRange(profileId, section, exam, from, to, valid);
  const range = preview.data ?? null;
  const empty = range !== null && range.question_count === 0;
  /** The range holds questions, but every one of them is being kept for a mock test (M7.27) — so
   * starting it could only open an empty session. Said in place rather than discovered in there. */
  const reservedOnly = range !== null && range.question_count > 0 && range.reserved_for_tests === range.question_count;

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <h2 className="font-semibold">{t("topik.picker.rangeTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("topik.picker.rangeHint")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {t("topik.picker.rangeFrom")}
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={maxNumber}
            value={fromText}
            onChange={(e) => setFromText(e.target.value)}
            className="w-24"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("topik.picker.rangeTo")}
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={maxNumber}
            value={toText}
            onChange={(e) => setToText(e.target.value)}
            className="w-24"
          />
        </label>
        <Button
          type="button"
          disabled={!valid || empty || reservedOnly || range === null}
          onClick={() => range && onStart({ from: range.from, to: range.to })}
        >
          {t("topik.picker.rangeStart")}
        </Button>
      </div>

      {/* What the range really is, while it is being typed. */}
      {range !== null && (
        <div className="flex flex-col gap-1 text-sm">
          {range.expanded && (
            <p className="text-amber-700 dark:text-amber-500">
              {t("topik.picker.rangeWidened", { from: range.from, to: range.to, added: range.added.join(", ") })}
            </p>
          )}
          {empty ? (
            <p className="text-destructive">{t("topik.picker.rangeEmpty")}</p>
          ) : (
            <p className="text-muted-foreground">{t("topik.picker.rangeCount", { count: range.question_count })}</p>
          )}
          {/* How many of them a session here would not serve, and why. */}
          {range.reserved_for_tests > 0 && (
            <p className={reservedOnly ? "text-destructive" : "text-muted-foreground"}>
              {t("topik.reservedOnly", { count: range.reserved_for_tests })}
            </p>
          )}
          {/* A hole is only a hole inside one paper (M7.24); across all of them it is a paper that
              is not typed up yet, so the breakdown is the honest answer instead. */}
          {range.missing_number !== null && <p className="text-destructive">{t("topik.picker.rangeMissing", { n: range.missing_number })}</p>}
          {exam === null && range.by_exam.length > 1 && (
            <p className="text-muted-foreground">
              {t("topik.picker.rangeByExam", { list: range.by_exam.map((e) => `${e.exam} (${e.count})`).join(" · ") })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
