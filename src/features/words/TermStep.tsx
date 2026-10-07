import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EXAMPLE_LEVELS, exampleLevelSchema, type ExampleLevel, type LearnLang } from "@shared/enums";
import { TERM_MAX } from "@shared/word";
import { FormField } from "@/components/FormField";
import { HTML_LANG } from "@/lib/htmlLang";
import { NativeSelect } from "@/components/NativeSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LangChips } from "./bits";

type Props = {
  lang: LearnLang;
  term: string;
  level: ExampleLevel;
  onLangChange: (lang: LearnLang) => void;
  onTermChange: (term: string) => void;
  onLevelChange: (level: ExampleLevel) => void;
  onAiFill: () => void;
  onManual: () => void;
  enriching: boolean;
  termError?: string;
  /** Error / duplicate notice shown under the buttons. */
  notice?: ReactNode;
};

/** Step 1 of "Add word": language, term, example level, then AI fill or manual entry. */
export function TermStep(props: Props) {
  const { t } = useTranslation();

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        props.onAiFill();
      }}
    >
      <FormField id="w-lang" label={t("words.add.lang")}>
        <LangChips
          label={t("words.add.lang")}
          value={props.lang}
          onChange={(l) => l && props.onLangChange(l)}
        />
      </FormField>

      <FormField id="w-term" label={t("words.add.term")} error={props.termError}>
        <Input
          id="w-term"
          lang={HTML_LANG[props.lang]}
          value={props.term}
          maxLength={TERM_MAX}
          autoComplete="off"
          autoCapitalize="off"
          aria-invalid={!!props.termError}
          onChange={(e) => props.onTermChange(e.target.value)}
          className="h-14 text-2xl"
        />
      </FormField>

      <FormField id="w-level" label={t("words.add.level")}>
        <NativeSelect
          id="w-level"
          value={props.level}
          onChange={(e) => {
            const parsed = exampleLevelSchema.safeParse(e.target.value);
            if (parsed.success) props.onLevelChange(parsed.data);
          }}
        >
          {EXAMPLE_LEVELS.map((lv) => (
            <option key={lv} value={lv}>
              {t(`words.levels.${lv}`)}
            </option>
          ))}
        </NativeSelect>
      </FormField>

      <Button type="submit" size="lg" disabled={props.enriching}>
        <Sparkles aria-hidden />
        {props.enriching ? t("words.add.aiFilling") : t("words.add.aiFill")}
      </Button>
      <Button type="button" variant="outline" disabled={props.enriching} onClick={props.onManual}>
        {t("words.add.manual")}
      </Button>
      {props.notice}
    </form>
  );
}
