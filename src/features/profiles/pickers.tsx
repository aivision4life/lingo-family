import { useTranslation } from "react-i18next";
import { LEARN_LANGS, type CardType, type LearnLang } from "@shared/enums";
import { AVATARS, REVIEW_CARD_TYPES } from "@shared/profile";
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

type CardTypesPickerProps = {
  id: string;
  value: CardType[];
  onChange: (types: CardType[]) => void;
};

/**
 * Which review card types this profile practises (M6.6). Switching one off only stops its cards
 * from being offered — their schedule and history are kept, so switching it back on resumes.
 */
export function CardTypesPicker({ id, value, onChange }: CardTypesPickerProps) {
  const { t } = useTranslation();
  const toggle = (type: CardType) =>
    onChange(value.includes(type) ? value.filter((x) => x !== type) : [...value, type]);

  return (
    <div id={id} role="group" className="grid grid-cols-3 gap-2">
      {REVIEW_CARD_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          aria-pressed={value.includes(type)}
          onClick={() => toggle(type)}
          className={cn(chip(value.includes(type)), "px-1 py-1 text-xs leading-tight sm:text-sm")}
        >
          {t(`review.cardType.${type}`)}
        </button>
      ))}
    </div>
  );
}
