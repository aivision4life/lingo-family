import { z } from "zod";

// Enum values shared by the DB schema, the API and the UI.

// Chinese (zh) was removed from the product in M1.6.
export const LEARN_LANGS = ["ko", "en"] as const;
export const learnLangSchema = z.enum(LEARN_LANGS);
export type LearnLang = z.infer<typeof learnLangSchema>;

/** Languages for UI text and for glosses (meanings) shown on cards. */
export const UI_LANGS = ["vi", "ko", "en"] as const;
export const uiLangSchema = z.enum(UI_LANGS);
export type UiLang = z.infer<typeof uiLangSchema>;

export const CARD_TYPES = ["recognition", "picture", "listening", "speaking"] as const;
export const cardTypeSchema = z.enum(CARD_TYPES);
export type CardType = z.infer<typeof cardTypeSchema>;

/** `default` = the per-language deck that every word is in (cards come from it); `album` = a family-made playlist of words (M2.4). */
export const DECK_KINDS = ["default", "album"] as const;
export const deckKindSchema = z.enum(DECK_KINDS);
export type DeckKind = z.infer<typeof deckKindSchema>;

export const EXAMPLE_LEVELS = ["kid", "beginner", "intermediate"] as const;
export const exampleLevelSchema = z.enum(EXAMPLE_LEVELS);
export type ExampleLevel = z.infer<typeof exampleLevelSchema>;

export const USAGE_SERVICES = ["tts", "pron", "llm", "image"] as const;
export const usageServiceSchema = z.enum(USAGE_SERVICES);
export type UsageService = z.infer<typeof usageServiceSchema>;

/**
 * Image of a word, phrase or example (M1.8). none = not requested yet (lazy example, quota
 * reached, item saved before M1.8), pending = being drawn, ready = image_key set, failed.
 */
export const IMAGE_STATUSES = ["none", "pending", "ready", "failed"] as const;
export const imageStatusSchema = z.enum(IMAGE_STATUSES);
export type ImageStatus = z.infer<typeof imageStatusSchema>;

export const IMAGE_SOURCES = ["ai", "upload"] as const;
export const imageSourceSchema = z.enum(IMAGE_SOURCES);
export type ImageSource = z.infer<typeof imageSourceSchema>;
