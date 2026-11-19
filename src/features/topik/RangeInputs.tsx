import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";

/**
 * The two number boxes of the range picker (M7.24), and nothing else.
 *
 * Extracted so the podcast (M8.1) asks for a range the same way practice does — same boxes, same
 * half-typed-number behaviour, same validity rule — while each screen keeps its own answer to
 * "what would this range really give me", which is a different question for each of them.
 */
export function RangeInputs({
  maxNumber,
  value,
  onChange,
}: {
  /** Upper bound for the inputs only. */
  maxNumber: number;
  value: { from: number; to: number; valid: boolean };
  onChange: (next: { from: number; to: number; valid: boolean }) => void;
}) {
  const { t } = useTranslation();
  // Kept as text so a half-typed number does not jump about under the thumb.
  const [fromText, setFromText] = useState(String(value.from));
  const [toText, setToText] = useState(String(value.to));

  const emit = (fromStr: string, toStr: string) => {
    const from = Number(fromStr);
    const to = Number(toStr);
    const valid = Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from;
    onChange({ from, to, valid });
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">
        {t("topik.picker.rangeFrom")}
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={maxNumber}
          value={fromText}
          onChange={(e) => {
            setFromText(e.target.value);
            emit(e.target.value, toText);
          }}
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
          onChange={(e) => {
            setToText(e.target.value);
            emit(fromText, e.target.value);
          }}
          className="w-24"
        />
      </label>
    </div>
  );
}
