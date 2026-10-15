import { z } from "zod";
import { learnLangSchema, uiLangSchema } from "./enums";

/** Avatars are emoji (free, instant, kid-friendly). */
export const AVATARS = [
  "🐻", "🐼", "🦊", "🐯", "🐰", "🐨", "🐸", "🐵",
  "🦁", "🐧", "🐳", "🦄", "🐙", "🐝", "🌻", "🚀",
] as const;

export const PIN_LENGTH = 4;
export const DAILY_NEW_LIMIT_MAX = 100;

export const pinSchema = z.string().regex(/^\d{4}$/, "pin_format");

const editableFields = {
  name: z.string().trim().min(1, "name_required").max(30, "name_too_long"),
  avatar: z.enum(AVATARS),
  ui_lang: uiLangSchema,
  gloss_lang: uiLangSchema,
  is_kid: z.boolean(),
  daily_new_limit: z.number().int().min(0).max(DAILY_NEW_LIMIT_MAX),
  study_langs: z
    .array(learnLangSchema)
    .min(1, "study_langs_required")
    .refine((langs) => new Set(langs).size === langs.length, "study_langs_duplicate"),
};

const kidHasNoPin = (p: { is_kid?: boolean; pin?: string | null }) => !(p.is_kid && p.pin);
const kidPinIssue = { message: "kid_cannot_have_pin", path: ["pin"] };

/** POST /api/profiles */
export const profileCreateSchema = z
  .object({ ...editableFields, pin: pinSchema.optional() })
  .refine(kidHasNoPin, kidPinIssue);
export type ProfileCreate = z.infer<typeof profileCreateSchema>;

/**
 * PATCH /api/profiles/:id — every field optional.
 * `pin`: string = set new PIN, null = remove PIN, absent = keep.
 */
export const profileUpdateSchema = z
  .object({ ...editableFields, pin: pinSchema.nullable() })
  .partial()
  .refine(kidHasNoPin, kidPinIssue);
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/** A profile as sent to the client. Never contains the PIN hash. */
export const profileSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string(),
  /** R2 key of an uploaded photo (M2.10); takes priority over `avatar` (emoji) when set. Served via `/api/media/{key}`. */
  avatar_photo: z.string().nullable(),
  ui_lang: uiLangSchema,
  gloss_lang: uiLangSchema,
  is_kid: z.boolean(),
  daily_new_limit: z.number().int(),
  study_langs: z.array(learnLangSchema),
  has_pin: z.boolean(),
  created_at: z.number(),
});
export type Profile = z.infer<typeof profileSchema>;

export const profileListSchema = z.array(profileSchema);

export const verifyPinRequestSchema = z.object({ pin: pinSchema });
export const verifyPinResponseSchema = z.object({ ok: z.boolean() });

/** Error codes returned by the profiles API (besides generic "invalid_input"/"not_found"). */
export const PROFILE_ERRORS = {
  /** There must always be at least one adult profile. */
  lastAdult: "last_adult",
} as const;
