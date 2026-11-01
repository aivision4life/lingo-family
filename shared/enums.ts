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
/** Library filter (M2.7): which words/phrases to show, relative to a profile. */
export const LIBRARY_SCOPES = ["learning", "mine", "all"] as const;
export const libraryScopeSchema = z.enum(LIBRARY_SCOPES);
export type LibraryScope = z.infer<typeof libraryScopeSchema>;

export const DECK_KINDS = ["default", "album"] as const;
export const deckKindSchema = z.enum(DECK_KINDS);
export type DeckKind = z.infer<typeof deckKindSchema>;

export const EXAMPLE_LEVELS = ["kid", "beginner", "intermediate"] as const;
export const exampleLevelSchema = z.enum(EXAMPLE_LEVELS);
export type ExampleLevel = z.infer<typeof exampleLevelSchema>;

// "topik_vocab" (M6.2) and "topik_explain" (M6.3) are logged but never capped — see
// worker/lib/quota.ts#recordUsage.
export const USAGE_SERVICES = ["tts", "pron", "llm", "image", "topik_vocab", "topik_explain"] as const;
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

/** TOPIK II practice (M6.1): only reading exists so far; listening/writing come later. */
/** TOPIK II sections we practise. Listening (M7.1) shares the question bank and scheduling. */
export const TOPIK_SECTIONS = ["reading", "listening"] as const;
export const topikSectionSchema = z.enum(TOPIK_SECTIONS);

/** Mock test (M6.4): one real paper, or — from stage 2 — positions drawn from the whole bank. */
export const TOPIK_TEST_KINDS = ["original", "mixed"] as const;
export const topikTestKindSchema = z.enum(TOPIK_TEST_KINDS);

/** "abandoned" = left before the end: no score, no attempts, no effect on the FSRS schedule. */
export const TOPIK_TEST_STATUSES = ["running", "finished", "abandoned"] as const;
export const topikTestStatusSchema = z.enum(TOPIK_TEST_STATUSES);
export type TopikSection = z.infer<typeof topikSectionSchema>;
