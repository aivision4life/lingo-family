import type { z } from "zod";
import type { CardType, LearnLang, UiLang } from "@shared/enums";
import {
  AVATARS,
  DEFAULT_CARD_TYPES,
  profileCreateSchema,
  profileUpdateSchema,
  type Profile,
  type ProfileCreate,
  type ProfileUpdate,
} from "@shared/profile";

/** Raw form state (inputs are strings until validated). */
export type FormValues = {
  name: string;
  avatar: (typeof AVATARS)[number];
  ui_lang: UiLang;
  gloss_lang: UiLang;
  is_kid: boolean;
  daily_new_limit: string;
  study_langs: LearnLang[];
  /** Which review card types this profile practises (M6.6). */
  card_types: CardType[];
  /** New PIN; empty = none (create) / keep (edit). */
  pin: string;
  removePin: boolean;
};

export const FIELDS_WITH_ERRORS = ["name", "pin", "study_langs", "card_types", "daily_new_limit"] as const;
export type FieldWithError = (typeof FIELDS_WITH_ERRORS)[number];
export type FieldErrors = Partial<Record<FieldWithError, true>>;

type Result<T> = { data: T; errors: null } | { data: null; errors: FieldErrors };

export function emptyFormValues(uiLang: UiLang): FormValues {
  return {
    name: "",
    avatar: AVATARS[0],
    ui_lang: uiLang,
    gloss_lang: uiLang,
    is_kid: false,
    daily_new_limit: "10",
    study_langs: [],
    card_types: DEFAULT_CARD_TYPES,
    pin: "",
    removePin: false,
  };
}

const isAvatar = (s: string): s is FormValues["avatar"] => (AVATARS as readonly string[]).includes(s);

export function formValuesFromProfile(p: Profile): FormValues {
  return {
    name: p.name,
    avatar: isAvatar(p.avatar) ? p.avatar : AVATARS[0],
    ui_lang: p.ui_lang,
    gloss_lang: p.gloss_lang,
    is_kid: p.is_kid,
    daily_new_limit: String(p.daily_new_limit),
    study_langs: p.study_langs,
    card_types: p.card_types,
    pin: "",
    removePin: false,
  };
}

const commonFields = (v: FormValues) => ({
  name: v.name,
  avatar: v.avatar,
  ui_lang: v.ui_lang,
  gloss_lang: v.gloss_lang,
  is_kid: v.is_kid,
  // Empty input must fail validation instead of becoming 0.
  daily_new_limit: v.daily_new_limit.trim() === "" ? Number.NaN : Number(v.daily_new_limit),
  study_langs: v.study_langs,
  card_types: v.card_types,
});

function parse<S extends z.ZodType>(schema: S, input: unknown): Result<z.output<S>> {
  const result = schema.safeParse(input);
  if (result.success) return { data: result.data, errors: null };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if ((FIELDS_WITH_ERRORS as readonly unknown[]).includes(field)) errors[field as FieldWithError] = true;
  }
  return { data: null, errors };
}

export function toCreateInput(v: FormValues): Result<ProfileCreate> {
  const pin = v.is_kid || v.pin === "" ? undefined : v.pin;
  return parse(profileCreateSchema, { ...commonFields(v), pin });
}

export function toUpdateInput(v: FormValues): Result<ProfileUpdate> {
  // Kids never have a PIN (the server clears it); otherwise remove / set / keep.
  let pin: string | null | undefined;
  if (v.is_kid) pin = undefined;
  else if (v.removePin) pin = null;
  else if (v.pin !== "") pin = v.pin;
  return parse(profileUpdateSchema, { ...commonFields(v), pin });
}
