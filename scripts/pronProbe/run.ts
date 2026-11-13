// M3.0 probe from the command line: send one take to Azure Pronunciation Assessment and keep the
// answer exactly as it came. Read and print only — no D1, no R2, no `pron_attempts`, no quota row.
//
//   npm run pron-probe -- --tts "사과"                      Azure TTS speaks it (the known-good take), then it is scored
//   npm run pron-probe -- --lang en --tts "apple"           same in en-US (adds EnableProsodyAssessment)
//   npm run pron-probe -- --tts "사과" --text "사가"        score that take against a different text
//   npm run pron-probe -- --file take.wav --text "사과"     a take recorded by hand (16 kHz mono 16-bit WAV)
//   npm run pron-probe -- --tts "사과" --concurrent         two requests at once: what does F0's limit of
//                                                           one concurrent request answer with?
//   optional: --miscue   --alphabet IPA|SAPI
//
// Output: data/pron-probe/out/<stamp>-<lang>-<source>[-N].json is Azure's body byte for byte (.txt
// when it is not JSON), next to a .meta.json (status, headers, timing, what was asked) and, for
// --tts, the synthesized .wav. `data/` is gitignored.
//
// Cost: every request sends the whole take to speech-to-text, which on the free tier comes out of
// 5 hours a month shared by the whole family. The run prints how many seconds it used, and refuses
// what the app itself refuses (`checkWav`, PRON_MAX_SECONDS): one limit, defined in one place.
// Needs AZURE_SPEECH_KEY / AZURE_SPEECH_REGION in `.dev.vars`
// (a plain local file, read directly — the same key `npm run dev` uses).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checkWav, PRON_MAX_SECONDS } from "../../shared/wav";
import { azureSpeechConfig } from "../../worker/services/azureSpeech";
import { pronEndpoint, pronRequestHeaders } from "../../worker/services/pronunciation";
import { buildSsml, DEFAULT_VOICES } from "../../worker/services/tts";
import { billedSeconds, hexHead, outBase, parseProbeArgs, probeOptions } from "./plan";

const OUT_DIR = path.join("data", "pron-probe", "out");
const TIMEOUT_MS = 30_000;

function readDevVars(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(".dev.vars")) return out;
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}

const fail = (message: string): never => {
  console.error(`\npron-probe: ${message}`);
  process.exit(1);
};

/** The keys of an object, or a note of what was there instead: enough to see a shape at a glance. */
const keysOf = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).join(", ") : `(${typeof value})`);
const first = (value: unknown, key: string): unknown => {
  const list = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  return Array.isArray(list) ? list[0] : undefined;
};

const parsed = parseProbeArgs(process.argv.slice(3));
if ("error" in parsed) fail(parsed.error);
const args = parsed as Exclude<typeof parsed, { error: string }>;

const vars = readDevVars();
const config = azureSpeechConfig(vars) ?? fail("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION are missing or malformed in .dev.vars");

mkdirSync(OUT_DIR, { recursive: true });
const base = path.join(OUT_DIR, outBase(new Date(), args.lang, args.tts ? "tts" : "file"));

// --- the take -----------------------------------------------------------------------------------
let wav: Uint8Array;
if (args.tts) {
  const voice = DEFAULT_VOICES[args.lang];
  const res = await fetch(`https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": config.key,
      "Content-Type": "application/ssml+xml",
      // Straight to what the scorer takes: no mp3 to decode, nothing resampled on the way.
      "X-Microsoft-OutputFormat": "riff-16khz-16bit-mono-pcm",
      "User-Agent": "lingo-family",
    },
    body: buildSsml(args.tts, args.lang, voice),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) fail(`Azure TTS answered HTTP ${res.status} ${res.statusText}\n--- body, verbatim ---\n${await res.text()}\n--- end ---`);
  wav = new Uint8Array(await res.arrayBuffer());
  writeFileSync(`${base}.wav`, wav);
  console.log(`TTS (${voice}) spoke "${args.tts}" → ${base}.wav`);
} else {
  if (!existsSync(args.file!)) fail(`no such file: ${args.file}`);
  wav = new Uint8Array(readFileSync(args.file!));
}

const check = checkWav(wav);
// Refused audio is shown, not explained away: if Azure TTS ever answers with a header this check
// does not accept, the bytes are right here to read before anyone loosens the check.
if (!check.ok) {
  fail(
    `refusing this audio: ${check.reason} (needs 16 kHz mono 16-bit PCM WAV, at most ${PRON_MAX_SECONDS} s)\n` +
      `${wav.length} bytes${args.tts ? `, as Azure TTS returned them (kept in ${base}.wav)` : ""}; the first 44:\n${hexHead(wav)}`,
  );
}
const durationMs = (check as { ok: true; durationMs: number }).durationMs;

// --- the request(s) -----------------------------------------------------------------------------
const requests = args.concurrent ? 2 : 1;
const options = probeOptions(args);
const url = pronEndpoint(config.region, args.lang);
console.log(`\nScoring against "${args.text}" (${args.lang}), ${requests} request(s), options ${JSON.stringify(options)}`);
console.log(`Audio: ${(durationMs / 1000).toFixed(2)} s per request → ${billedSeconds(durationMs, requests).toFixed(2)} s of speech-to-text this run`);

const body = new Uint8Array(wav).buffer;
const call = async (n: number) => {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: pronRequestHeaders(config.key, args.text, options),
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    return { n, status: res.status as number | null, statusText: res.statusText, headers: Object.fromEntries(res.headers.entries()), text, ms: Date.now() - started };
  } catch (e) {
    return { n, status: null, statusText: "no response", headers: {}, text: String(e), ms: Date.now() - started };
  }
};
const results = await Promise.all(Array.from({ length: requests }, (_x, i) => call(i + 1)));

// --- the report ---------------------------------------------------------------------------------
for (const r of results) {
  const stem = requests > 1 ? `${base}-${r.n}` : base;
  let json: unknown;
  try {
    json = JSON.parse(r.text);
  } catch {
    json = undefined;
  }
  const bodyFile = `${stem}.${json === undefined ? "txt" : "json"}`;
  writeFileSync(bodyFile, r.text); // verbatim: not re-serialized
  writeFileSync(
    `${stem}.meta.json`,
    JSON.stringify(
      { asked: { lang: args.lang, reference_text: args.text, source: args.tts ? "tts" : args.file, options, audio_ms: durationMs, concurrent: args.concurrent }, status: r.status, status_text: r.statusText, ms: r.ms, headers: r.headers },
      null,
      2,
    ),
  );

  console.log(`\n#${r.n}: HTTP ${r.status ?? "—"} ${r.statusText} in ${r.ms} ms → ${bodyFile}`);
  if (r.status !== 200 || json === undefined) {
    console.log(`--- body, verbatim (${r.text.length} chars) ---\n${r.text}\n--- end ---`);
    console.log(`headers: ${JSON.stringify(r.headers)}`);
    continue;
  }
  const best = first(json, "NBest");
  const word = first(best, "Words");
  console.log(`  top level : ${keysOf(json)}`);
  console.log(`  NBest[0]  : ${keysOf(best)}`);
  console.log(`  Words[0]  : ${keysOf(word)}`);
  console.log(`  Phonemes[0]: ${keysOf(first(word, "Phonemes"))} = ${JSON.stringify(first(word, "Phonemes"))}`);
  console.log(`  Syllables[0]: ${keysOf(first(word, "Syllables"))} = ${JSON.stringify(first(word, "Syllables"))}`);
}
console.log(`\nTotal audio sent to speech-to-text: ${billedSeconds(durationMs, requests).toFixed(2)} s`);
