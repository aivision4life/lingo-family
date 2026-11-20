/**
 * The playlist a TOPIK listening podcast plays (SPEC F13, M8.1).
 *
 * The server builds it because every rule it has to obey already lives on the server: which
 * questions a profile may be served (M7.27), which questions have a clip at all, and which TTS
 * files exist. The client only plays what it is handed.
 *
 * Nothing here writes anything — no FSRS, no `topik_attempts`, no "heard it" mark (F13: a podcast
 * is no evidence of recall, and a listener who dozed off looks exactly like one who got it right).
 */
import {
  PODCAST_GAP_MS,
  podcastClipEnd,
  podcastSpeech,
  type PodcastPlaylist,
  type PodcastQuestion,
  type PodcastSpeech,
  type PodcastTrack,
  PODCAST_FIRST_SPEAKABLE_NUMBER,
  PODCAST_MANIFEST_KEY,
  podcastManifestSchema,
} from "../../shared/podcast";
import type { TopikClip, TopikOptions } from "../../shared/topik";
import { audioKey } from "./tts";

export type PodcastRow = {
  id: string;
  exam: string;
  number: number;
  instruction: string | null;
  options: TopikOptions;
  correct_option: number;
  segment_id: string | null;
};

/**
 * The files the script has already made.
 *
 * Asking R2 whether each key exists would be the obvious thing and is the wrong thing: a 50-question
 * paper is ~110 keys, and on the free plan a Worker may make 50 subrequests per request — a bucket
 * read is one of them. So the one-off script writes down what it generated, and this is one read.
 * A key that is not in the list is treated as missing, which is the safe direction: the question is
 * left out and said out loud, never played half.
 */
export async function readPodcastManifest(bucket: R2Bucket): Promise<Set<string>> {
  const object = await bucket.get(PODCAST_MANIFEST_KEY);
  if (!object) return new Set();
  const parsed = podcastManifestSchema.safeParse(await object.json().catch(() => null));
  return new Set(parsed.success ? parsed.data.keys : []);
}

/** The four content keys one question's speech is stored under. */
export async function podcastKeys(speech: PodcastSpeech, voice: string): Promise<Record<keyof PodcastSpeech, string>> {
  const [number, questionLine, options, answer] = await Promise.all([
    audioKey("ko", voice, speech.number),
    audioKey("ko", voice, speech.questionLine),
    audioKey("ko", voice, speech.options),
    audioKey("ko", voice, speech.answer),
  ]);
  return { number, questionLine, options, answer };
}

export type PodcastBuild = {
  rows: readonly PodcastRow[];
  /** Clip per `segment_id`; a question whose clip is missing is left out (F13: never substituted). */
  clips: ReadonlyMap<string, TopikClip>;
  /** Question ids held back for a mock test (M7.27), already decided by the caller. */
  reserved: ReadonlySet<string>;
  /**
   * When the listener asked for mastered questions only: the ids this profile has mastered, the
   * one definition in `shared/topikMastery.ts`. `null` means the filter is off — an empty set
   * means it is on and nothing qualifies, which are different answers and are counted as such.
   */
  mastered: ReadonlySet<string> | null;
  /** Keys `readPodcastManifest` found. */
  generated: ReadonlySet<string>;
  voice: string;
};

/**
 * One question's tape, in F13's order:
 *   number → question line → **the original clip** → the four options → the gap → the answer,
 * announced in Korean and read twice.
 *
 * A pair that shares one clip (21-22 and up) carries that clip once each, so a question is still
 * a whole question when heard on its own — which is the only way a podcast is ever heard.
 */
function tracksFor(keys: Record<keyof PodcastSpeech, string>, clip: TopikClip): PodcastTrack[] {
  return [
    { kind: "file", audio_key: keys.number },
    { kind: "file", audio_key: keys.questionLine },
    // The paper's own answering silence is dropped: the podcast has a gap of its own, and
    // `end_ms` is where the tape announces the next question (see `podcastClipEnd`).
    { kind: "clip", ...clip, end_ms: podcastClipEnd(clip) },
    { kind: "file", audio_key: keys.options },
    { kind: "silence", ms: PODCAST_GAP_MS },
    { kind: "file", audio_key: keys.answer },
  ];
}

/**
 * The playlist, and an honest count of everything the selection covered but the playlist leaves
 * out. Silently returning 47 questions when 50 were asked for is the failure this project keeps
 * finding (SPEC §11 M7.3), so every dropped question lands in one of the four counters.
 *
 * Order: by question number, then by paper. Across every paper the point of a range is drilling
 * one *kind* of question, so hearing every paper's question 16 together is what was asked for.
 */
export async function buildPodcastPlaylist({ rows, clips, reserved, mastered, generated, voice }: PodcastBuild): Promise<Omit<PodcastPlaylist, "from" | "to" | "expanded">> {
  const skipped = { picture_options: 0, not_mastered: 0, no_clip: 0, reserved_for_tests: 0, no_tts: 0 };
  const ordered = [...rows].sort((a, b) => a.number - b.number || a.exam.localeCompare(b.exam));
  const questions: PodcastQuestion[] = [];

  for (const row of ordered) {
    // Questions 1-3 answer with four pictures: there is nothing to read out, ever.
    if (row.number < PODCAST_FIRST_SPEAKABLE_NUMBER) {
      skipped.picture_options += 1;
      continue;
    }
    // Asked before the mock-test rule on purpose: a question nobody has answered is also one
    // nobody has mastered, and "not learnt yet" is the reason that answers the listener's question.
    if (mastered !== null && !mastered.has(row.id)) {
      skipped.not_mastered += 1;
      continue;
    }
    if (reserved.has(row.id)) {
      skipped.reserved_for_tests += 1;
      continue;
    }
    const clip = row.segment_id ? clips.get(row.segment_id) : undefined;
    if (!clip) {
      skipped.no_clip += 1;
      continue;
    }
    const speech = podcastSpeech(row);
    if (!speech) {
      // A question with a picture option or no question line among 4-50: same reason as 1-3.
      skipped.picture_options += 1;
      continue;
    }
    const keys = await podcastKeys(speech, voice);
    if (Object.values(keys).some((k) => !generated.has(k))) {
      skipped.no_tts += 1;
      continue;
    }
    questions.push({
      id: row.id,
      exam: row.exam,
      number: row.number,
      question_line: speech.questionLine,
      tracks: tracksFor(keys, clip),
    });
  }

  return { questions, skipped, gap_ms: PODCAST_GAP_MS };
}
