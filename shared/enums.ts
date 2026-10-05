import { z } from "zod";

// Enum values shared by the DB schema, the API and the UI.

export const LEARN_LANGS = ["ko", "zh", "en"] as const;
export const learnLangSchema = z.enum(LEARN_LANGS);
export type LearnLang = z.infer<typeof learnLangSchema>;

/** Languages for UI text and for glosses (meanings) shown on cards. */
export const UI_LANGS = ["vi", "ko", "en"] as const;
export const uiLangSchema = z.enum(UI_LANGS);
export type UiLang = z.infer<typeof uiLangSchema>;

export const CARD_TYPES = ["recognition", "listening", "speaking"] as const;
export const cardTypeSchema = z.enum(CARD_TYPES);
export type CardType = z.infer<typeof cardTypeSchema>;

export const EXAMPLE_LEVELS = ["kid", "beginner", "intermediate"] as const;
export const exampleLevelSchema = z.enum(EXAMPLE_LEVELS);
export type ExampleLevel = z.infer<typeof exampleLevelSchema>;

export const USAGE_SERVICES = ["tts", "pron", "llm"] as const;
export const usageServiceSchema = z.enum(USAGE_SERVICES);
export type UsageService = z.infer<typeof usageServiceSchema>;
