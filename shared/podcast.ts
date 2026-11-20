/**
 * What one TOPIK listening question sounds like as a podcast (SPEC F13, M8.1).
 *
 * Pure on purpose, and shared by three readers that must agree to the character: the Worker
 * (which builds a playlist and looks its files up in R2 by content key), the one-off script
 * (which synthesises those same files) and the test suite. A second copy of these strings would
 * mean a second set of R2 keys — every file generated twice and never found again.
 *
 * The order of one question is F13's and is not negotiable:
 *   number → question line → **the original clip** → the four options → a gap → the answer,
 *   announced in Korean and read twice.
 * The clip is never replaced by TTS; a question without one is left out of the podcast.
 */

import { z } from "zod";
import { topikClipSchema } from "./topik";

/** The thinking gap, fixed in M8.1 (3/5/8 and the longer gap for 21-50 are M8.3). */
export const PODCAST_GAP_MS = 5_000;

/**
 * How much of a clip is kept after the last word: enough not to clip the speech, and nothing more.
 *
 * A paper's clip ends at `end_ms`, the end of the **answering silence** a real sitting leaves — on
 * 36회 that is 17 seconds of nothing, and `end_ms` is also where the tape announces the *next*
 * question. A podcast has its own gap and does not need the paper's, so playing to `end_ms` only
 * meant the hand-over, which happens on a `timeupdate` up to a quarter of a second late, let the
 * next question's number be heard ("오", "칠"). Stopping a breath after the last word puts that
 * quarter of a second in silence, where nobody can hear it.
 */
export const PODCAST_CLIP_TAIL_MS = 800;

/**
 * Where a podcast stops a clip: a breath after the speech, never past the paper's own end.
 *
 * `speech_end_ms` is given by a human (M7.11) and for a pair sharing one clip (21 and up) it
 * already covers the second question's announcement — that rule is unchanged here; this only
 * drops the answering silence that follows it.
 */
export function podcastClipEnd(clip: { start_ms: number; speech_end_ms: number; end_ms: number }): number {
  return Math.max(clip.start_ms, Math.min(clip.speech_end_ms + PODCAST_CLIP_TAIL_MS, clip.end_ms));
}

/**
 * Questions 1-3 of every paper answer with four pictures, so there is nothing to read out and
 * they cannot be in a podcast at all. The picker says so out loud — quietly returning 47 of 50
 * is the failure this project keeps finding (SPEC §11 M7.3).
 */
export const PODCAST_FIRST_SPEAKABLE_NUMBER = 4;

/** Why a question the selection covered is not in the playlist. Every one of these is shown. */
export const PODCAST_SKIP_REASONS = ["picture_options", "no_clip", "reserved_for_tests", "no_tts"] as const;
export type PodcastSkipReason = (typeof PODCAST_SKIP_REASONS)[number];

// --- what is spoken ----------------------------------------------------------------------------

/** "4번." — the question number, in Korean, as its own file so all 50 of them are shared. */
export const podcastNumberText = (number: number) => `${number}번.`;

/**
 * The question line as it is read out: the paper's own instruction without the two things that
 * are printed for the eye only — the block it covers ("[4~8]") and what it scores ("(각 2점)").
 * Read aloud they are noise, and leaving them in would also give every block a different file.
 */
export function podcastQuestionLineText(instruction: string | null): string | null {
  if (!instruction) return null;
  const text = instruction
    .replace(/^\s*\[[^\]]*\]\s*/u, "")
    .replace(/\(\s*각\s*\d+\s*점\s*\)/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return text === "" ? null : text;
}

/** "1번. … 2번. … 3번. … 4번. …" — the four options in one file, so one handover covers them. */
export function podcastOptionsText(options: readonly { text: string | null }[]): string | null {
  const lines = options.map((o, i) => {
    const text = o.text?.trim();
    return text ? `${i + 1}번. ${text}` : null;
  });
  if (lines.some((l) => l === null)) return null;
  return lines.join(" ");
}

/**
 * "정답은 3번. …" and the option again.
 *
 * Twice is deliberate (F13): the first reading is what the listener checks their own answer
 * against, and only on the second is it heard as Korean.
 */
export function podcastAnswerText(correctOption: number, options: readonly { text: string | null }[]): string | null {
  const text = options[correctOption - 1]?.text?.trim();
  if (!text) return null;
  return `정답은 ${correctOption}번. ${text} ${text}`;
}

/** Everything spoken for one question, or null where the question cannot be spoken at all. */
export type PodcastSpeech = { number: string; questionLine: string; options: string; answer: string };

export function podcastSpeech(q: {
  number: number;
  instruction: string | null;
  options: readonly { text: string | null }[];
  correct_option: number;
}): PodcastSpeech | null {
  const questionLine = podcastQuestionLineText(q.instruction);
  const options = podcastOptionsText(q.options);
  const answer = podcastAnswerText(q.correct_option, q.options);
  if (!questionLine || !options || !answer) return null;
  return { number: podcastNumberText(q.number), questionLine, options, answer };
}

/** Characters Azure is billed for, for one question's four files. */
export const podcastSpeechLength = (s: PodcastSpeech) =>
  s.number.length + s.questionLine.length + s.options.length + s.answer.length;

// --- the playlist ------------------------------------------------------------------------------

/**
 * One piece of tape. `clip` is a slice of an exam's mp3 (the player already knows these), `file`
 * is a whole TTS mp3 whose length nobody knows until it loads, and `silence` is the thinking gap —
 * a pause the player keeps itself, never a generated file, so changing it later costs nothing.
 */
export const podcastTrackSchema = z.discriminatedUnion("kind", [
  topikClipSchema.extend({ kind: z.literal("clip") }),
  z.object({ kind: z.literal("file"), audio_key: z.string() }),
  z.object({ kind: z.literal("silence"), ms: z.number().int().positive() }),
]);
export type PodcastTrack = z.infer<typeof podcastTrackSchema>;

export const podcastQuestionSchema = z.object({
  id: z.string(),
  exam: z.string(),
  number: z.number().int().positive(),
  /** Shown on the screen while it plays; the ears get the Korean, the eyes get this. */
  question_line: z.string(),
  tracks: z.array(podcastTrackSchema),
});
export type PodcastQuestion = z.infer<typeof podcastQuestionSchema>;

export const podcastPlaylistSchema = z.object({
  questions: z.array(podcastQuestionSchema),
  /** How many questions the selection covered but the playlist leaves out, and why. */
  skipped: z.object({
    picture_options: z.number().int().nonnegative(),
    no_clip: z.number().int().nonnegative(),
    reserved_for_tests: z.number().int().nonnegative(),
    no_tts: z.number().int().nonnegative(),
  }),
  gap_ms: z.number().int().positive(),
  /** The range actually covered: widened to whole groups (M7.24), same rule as practice. */
  from: z.number().int().positive(),
  to: z.number().int().positive(),
  expanded: z.boolean(),
});
export type PodcastPlaylist = z.infer<typeof podcastPlaylistSchema>;

export const podcastQuerySchema = z.object({
  profile_id: z.string().min(1),
  /** One paper, or every paper when absent (which is what makes M7.27 apply). */
  exam: z.string().min(1).optional(),
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
});
export type PodcastQuery = z.infer<typeof podcastQuerySchema>;

/** The papers a podcast can be built from (listening only: there is nothing else to listen to). */
export const podcastPapersSchema = z.object({
  papers: z.array(z.object({ exam: z.string(), questions: z.number().int().nonnegative(), max_number: z.number().int().nonnegative() })),
  max_number: z.number().int().nonnegative(),
});
export type PodcastPapers = z.infer<typeof podcastPapersSchema>;

/** Where the script writes the list of TTS files it has made (see `worker/services/topikPodcast.ts`). */
export const PODCAST_MANIFEST_KEY = "podcast/tts-manifest.json";

export const podcastManifestSchema = z.object({
  version: z.literal(1),
  generated_at: z.string(),
  /** Full R2 keys, exactly as `audioKey()` builds them. */
  keys: z.array(z.string()),
});
export type PodcastManifest = z.infer<typeof podcastManifestSchema>;
