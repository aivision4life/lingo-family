// Pure parts of `npm run pron-probe` (M3.0): argument rules, request options, output names.
import type { LearnLang } from "../../shared/enums";
import type { PronOptions } from "../../worker/services/pronunciation";

export type ProbeArgs = {
  lang: LearnLang;
  /** Text to synthesize with Azure TTS as the "native speaker" take, or null. */
  tts: string | null;
  /** A WAV file recorded by hand, or null. Exactly one of `tts` / `file` is set. */
  file: string | null;
  /** Reference text the take is scored against. */
  text: string;
  /** Fire two identical requests at once, to see what the one-concurrent-request limit answers. */
  concurrent: boolean;
  miscue: boolean;
  alphabet: "IPA" | "SAPI" | undefined;
};

const valueOf = (args: readonly string[], flag: string) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};

/** Reads the flags; anything that would make the run ambiguous is an error, never a default. */
export function parseProbeArgs(args: readonly string[]): ProbeArgs | { error: string } {
  const lang = valueOf(args, "--lang") ?? "ko";
  if (lang !== "ko" && lang !== "en") return { error: `--lang must be ko or en, got "${lang}"` };

  const tts = valueOf(args, "--tts");
  const file = valueOf(args, "--file");
  if (args.includes("--tts") && (!tts || tts.startsWith("--"))) return { error: '--tts needs the text to speak: --tts "사과"' };
  if (args.includes("--file") && (!file || file.startsWith("--"))) return { error: "--file needs a path to a WAV file" };
  if (tts !== undefined && file !== undefined) return { error: "use --tts or --file, not both" };
  if (tts === undefined && file === undefined) return { error: 'nothing to score: pass --tts "<text>" or --file <wav> --text "<text>"' };

  // A synthesized take is scored against the text it was made from unless --text says otherwise
  // (that is how a deliberate mismatch is tried). A file has no text of its own.
  const text = (valueOf(args, "--text") ?? tts ?? "").trim();
  if (text === "" || text.startsWith("--")) return { error: '--file needs the reference text too: --text "사과"' };

  const alphabet = valueOf(args, "--alphabet");
  if (alphabet !== undefined && alphabet !== "IPA" && alphabet !== "SAPI") return { error: `--alphabet must be IPA or SAPI, got "${alphabet}"` };

  return {
    lang,
    tts: tts?.trim() ?? null,
    file: file ?? null,
    text,
    concurrent: args.includes("--concurrent"),
    miscue: args.includes("--miscue"),
    alphabet,
  };
}

/** Prosody is asked for on `en-US` only: that is the one locale Azure documents it for. */
export const probeOptions = (a: Pick<ProbeArgs, "lang" | "miscue" | "alphabet">): PronOptions => ({
  miscue: a.miscue,
  alphabet: a.alphabet,
  prosody: a.lang === "en",
});

/**
 * The first bytes of a file as hex with the printable ones beside them, 16 to a line. Printed when
 * audio is refused, so the reason can be read off the header itself instead of being guessed at
 * (44 bytes = the canonical WAV header).
 */
export function hexHead(bytes: Uint8Array, count = 44): string {
  const lines: string[] = [];
  for (let at = 0; at < Math.min(count, bytes.length); at += 16) {
    const row = [...bytes.subarray(at, Math.min(at + 16, count, bytes.length))];
    const hex = row.map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const text = row.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${at.toString(16).padStart(4, "0")}  ${hex.padEnd(47)}  ${text}`);
  }
  return lines.join("\n");
}

/** `20261113-080501-ko-tts`: sortable, ASCII only (the reference text never goes into a file name). */
export function outBase(now: Date, lang: LearnLang, source: "tts" | "file"): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${lang}-${source}`;
}

/** Seconds of audio a run sends to speech-to-text: every request carries the whole take. */
export const billedSeconds = (durationMs: number, requests: number) => (durationMs / 1000) * requests;
