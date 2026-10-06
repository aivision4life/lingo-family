import { useTranslation } from "react-i18next";
import { LEARN_LANGS, type LearnLang } from "@shared/enums";
import { AVATARS } from "@shared/profile";
import { cn } from "@/lib/utils";

const chip = (selected: boolean) =>
  cn(
    "flex min-h-11 items-center justify-center rounded-lg border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    selected ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent",
  );

type AvatarPickerProps = {
  id: string;
  value: string;
  onChange: (avatar: (typeof AVATARS)[number]) => void;
};

export function AvatarPicker({ id, value, onChange }: AvatarPickerProps) {
  return (
    <div id={id} role="group" className="grid grid-cols-6 gap-2 sm:grid-cols-8">
      {AVATARS.map((a) => (
        <button
          key={a}
          type="button"
          aria-pressed={a === value}
          onClick={() => onChange(a)}
          className={cn(chip(a === value), "aspect-square text-2xl")}
        >
          {a}
        </button>
      ))}
    </div>
  );
}

type StudyLangsPickerProps = {
  id: string;
  value: LearnLang[];
  onChange: (langs: LearnLang[]) => void;
};

export function StudyLangsPicker({ id, value, onChange }: StudyLangsPickerProps) {
  const { t } = useTranslation();
  const toggle = (lang: LearnLang) =>
    onChange(value.includes(lang) ? value.filter((l) => l !== lang) : [...value, lang]);

  return (
    <div id={id} role="group" className="grid grid-cols-3 gap-2">
      {LEARN_LANGS.map((lang) => (
        <button
          key={lang}
          type="button"
          aria-pressed={value.includes(lang)}
          onClick={() => toggle(lang)}
          className={cn(chip(value.includes(lang)), "px-2 text-sm")}
        >
          {t(`langs.${lang}`)}
        </button>
      ))}
    </div>
  );
}
