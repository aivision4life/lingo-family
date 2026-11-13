import { useEffect, useRef, useState } from "react";
import type { LearnLang } from "@shared/enums";
import { pronProbeResponseSchema } from "@shared/pron";
import { PRON_MAX_SECONDS } from "@shared/wav";
import { Button } from "@/components/ui/button";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { startRecording, type ActiveRecording } from "@/features/pron/recorder";
import { ApiError, apiUpload } from "@/lib/api";

/** The recorder stops by itself at the length the Worker accepts. */
const MAX_TAKE_MS = PRON_MAX_SECONDS * 1000;

type Take = { url: string; durationMs: number; sourceRate: number; bytes: number };
type Phase = "idle" | "recording" | "scoring";

/**
 * `/practice/probe` — scaffolding, not a feature (M3.0). Same idea as the M6.5 audio probe, and
 * like it deliberately ugly, with fixed Vietnamese text and no link pointing at it. Open to kid
 * profiles too: speaking practice is study, and theirs is the small-hands-on-a-phone case to try.
 *
 * Two things no test can settle, answered on a real phone before the scoring UI is written:
 *  1. does capturing raw PCM work in the installed PWA (listen to the take right here), and
 *  2. what does Azure actually return for `ko-KR` — phoneme scores, names, syllables? The raw JSON
 *     is printed untouched; the shape of `details_json` and the colouring follow from it.
 */
export function PronProbePage() {
  const { profile } = useActiveProfile();
  const [lang, setLang] = useState<LearnLang>("ko");
  const [text, setText] = useState("사과");
  const [miscue, setMiscue] = useState(false);
  const [alphabet, setAlphabet] = useState<"none" | "IPA" | "SAPI">("none");
  const [phase, setPhase] = useState<Phase>("idle");
  const [take, setTake] = useState<Take | null>(null);
  const [output, setOutput] = useState("");
  const active = useRef<ActiveRecording | null>(null);
  const timer = useRef<number | undefined>(undefined);

  // Leaving the page mid-take must let go of the microphone.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      active.current?.cancel();
    },
    [],
  );

  if (!profile) return null;

  const stop = async () => {
    window.clearTimeout(timer.current);
    const recording = active.current;
    active.current = null;
    if (!recording) return;
    setPhase("scoring");
    try {
      const rec = await recording.stop();
      setTake((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { url: URL.createObjectURL(rec.wav), durationMs: rec.durationMs, sourceRate: rec.sourceRate, bytes: rec.wav.size };
      });
      const query = new URLSearchParams({ profile_id: profile.id, lang, text, miscue: miscue ? "1" : "0", alphabet });
      const started = performance.now();
      const res = await apiUpload(`/pron/probe?${query.toString()}`, rec.wav, pronProbeResponseSchema);
      const total = Math.round(performance.now() - started);
      setOutput(`// tổng ${total} ms · Azure ${res.azure_ms} ms · server đo ${res.audio_ms} ms âm thanh\n${JSON.stringify(res.raw, null, 2)}`);
    } catch (e) {
      setOutput(e instanceof ApiError ? `LỖI ${e.status} ${e.code}\n${JSON.stringify(e.body, null, 2)}` : `LỖI ${String(e)}`);
    } finally {
      setPhase("idle");
    }
  };

  // Straight from the tap, no await before it: see startRecording().
  const start = () => {
    setOutput("");
    setPhase("recording");
    startRecording().then(
      (recording) => {
        active.current = recording;
        timer.current = window.setTimeout(() => void stop(), MAX_TAKE_MS);
      },
      (e: unknown) => {
        setPhase("idle");
        setOutput(`LỖI micro: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
      },
    );
  };

  const field = "min-h-11 rounded-md border bg-background px-3";
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">Pronunciation probe (M3.0)</h1>
      <p className="text-sm text-muted-foreground">
        Thu âm, nghe lại bản thu, rồi xem nguyên JSON Azure trả về. Mỗi lần chấm tính 1 lượt quota phát âm.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select className={field} value={lang} onChange={(e) => setLang(e.target.value === "en" ? "en" : "ko")} aria-label="Ngôn ngữ">
          <option value="ko">ko-KR</option>
          <option value="en">en-US</option>
        </select>
        <input
          className={`${field} min-w-0 flex-1`}
          lang={lang}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Văn bản mẫu"
        />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={miscue} onChange={(e) => setMiscue(e.target.checked)} /> EnableMiscue
        </label>
        <label className="flex min-h-11 items-center gap-2">
          PhonemeAlphabet
          <select
            className={field}
            value={alphabet}
            onChange={(e) => setAlphabet(e.target.value === "IPA" ? "IPA" : e.target.value === "SAPI" ? "SAPI" : "none")}
          >
            <option value="none">(không gửi)</option>
            <option value="IPA">IPA</option>
            <option value="SAPI">SAPI</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {phase === "recording" ? (
          <Button type="button" variant="destructive" onClick={() => void stop()}>
            Dừng và chấm
          </Button>
        ) : (
          <Button type="button" onClick={start} disabled={phase === "scoring" || text.trim() === ""}>
            {phase === "scoring" ? "Đang chấm…" : "Thu âm"}
          </Button>
        )}
        {phase === "recording" && <span className="text-sm text-destructive">● đang thu (tự dừng sau {MAX_TAKE_MS / 1000} giây)</span>}
      </div>

      {take && (
        <div className="flex flex-col gap-1">
          <audio controls src={take.url} className="w-full" />
          <p className="font-mono text-xs tabular-nums text-muted-foreground">
            micro {take.sourceRate} Hz → 16000 Hz · {(take.durationMs / 1000).toFixed(2)} s · {(take.bytes / 1024).toFixed(0)} KB
          </p>
        </div>
      )}

      <pre className="max-h-[32rem] overflow-auto rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap select-all">
        {output || "(chưa có gì)"}
      </pre>
    </section>
  );
}
