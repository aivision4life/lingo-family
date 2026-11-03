import { z } from "zod";
import { cardTypeSchema, learnLangSchema, uiLangSchema, type CardType } from "./enums";

/** Avatars are emoji (free, instant, kid-friendly). */
export const AVATARS = [
  "🐻", "🐼", "🦊", "🐯", "🐰", "🐨", "🐸", "🐵",
  "🦁", "🐧", "🐳", "🦄", "🐙", "🐝", "🌻", "🚀",
] as const;

/** The review card types a profile can switch off (M6.6); `speaking` is not a review type yet (M3). */
export const REVIEW_CARD_TYPES = ["recognition", "picture", "listening"] as const satisfies readonly CardType[];
export type ReviewCardType = (typeof REVIEW_CARD_TYPES)[number];
/** What every profile did before the setting existed, and what a new one starts with. */
export const DEFAULT_CARD_TYPES: ReviewCardType[] = [...REVIEW_CARD_TYPES];

export const PIN_LENGTH = 4;
export const DAILY_NEW_LIMIT_MAX = 100;

/**
 * How many questions one TOPIK practice session asks (M6.13).
 *
 * Only TOPIK practice has a session length to set: word review has none — it asks everything due
 * today plus up to `daily_new_limit` new cards, and that limit is the knob for how long a word
 * session runs. A fixed set of choices rather than a free number, because this is a "how long do
 * I want to sit here" decision, not a measurement.
 */
export const SESSION_SIZES = [5, 10, 15, 20] as const;
export type SessionSize = (typeof SESSION_SIZES)[number];
export const DEFAULT_SESSION_SIZE: SessionSize = 10;

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
  /** Review only what this profile added itself (M6.12); hides cards, never deletes them. */
  own_words_only: z.boolean(),
  /** Questions per TOPIK practice session (M6.13). */
  session_size: z.union(SESSION_SIZES.map((n) => z.literal(n)) as [z.ZodLiteral<5>, z.ZodLiteral<10>, z.ZodLiteral<15>, z.ZodLiteral<20>]),
  // At least one: with none enabled every review session would be empty, which looks like a bug
  // rather than a setting. Turning a type off never deletes its cards — they just stop appearing.
  card_types: z
    .array(cardTypeSchema.extract(REVIEW_CARD_TYPES))
    .min(1, "card_types_required")
    .refine((types) => new Set(types).size === types.length, "card_types_duplicate"),
};

const kidHasNoPin = (p: { is_kid?: boolean; pin?: string | null }) => !(p.is_kid && p.pin);
const kidPinIssue = { message: "kid_cannot_have_pin", path: ["pin"] };

/**
 * POST /api/profiles. `card_types` may be left out — an installed PWA can still be running a build
 * from before the setting existed, and it should keep working instead of getting a 400.
 */
export const profileCreateSchema = z
  .object({
    ...editableFields,
    card_types: editableFields.card_types.default(DEFAULT_CARD_TYPES),
    own_words_only: editableFields.own_words_only.default(false),
    // Defaulted for the same reason as `card_types`: an installed PWA may still be running a build
    // from before the setting existed, and must not start getting a 400.
    session_size: editableFields.session_size.default(DEFAULT_SESSION_SIZE),
    pin: pinSchema.optional(),
  })
  .refine(kidHasNoPin, kidPinIssue);
/** What a client sends (so an optional field with a default stays optional here). */
export type ProfileCreate = z.input<typeof profileCreateSchema>;

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
  card_types: z.array(cardTypeSchema),
  own_words_only: z.boolean(),
  session_size: z.number().int(),
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
