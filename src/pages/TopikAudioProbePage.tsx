import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { topikClipSchema } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import type { TapeEvent } from "@/features/topik/mixedTape";
import { tapeLogLine } from "@/features/topik/tapeLog";
import { useMixedTape } from "@/features/topik/useMixedTape";
import { api } from "@/lib/api";
import { formatDuration } from "@/features/topik/segmentEdit";

const probeSchema = z.object({ clips: z.array(topikClipSchema.extend({ exam: z.string(), number: z.number() })) });

/**
 * `/topik/tests/audio-probe` — scaffolding, not a feature (M6.5).
 *
 * The mixed mock test plays clips from several different mp3s through two `<audio>` elements
 * taking turns, and the one thing that can sink it is a phone refusing to play the second element
 * because no gesture ever started it. No test can catch that, so this page exists to answer it on
 * a real phone before the rest of the mode is written: four real clips from alternating exams, a
 * single Start button, and a log of exactly what the tape did.
 *
 * It is deliberately ugly and will be deleted once the real mode lands.
 */
export function TopikAudioProbePage() {
  const { profile } = useActiveProfile();
  const probe = useQuery({
    queryKey: ["topik", "probe-clips", profile?.id],
    queryFn: () => api("GET", `/topik/tests/probe-clips?profile_id=${profile!.id}&count=4`, probeSchema),
    enabled: !!profile,
  });

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">Audio probe (mixed tape)</h1>
      {probe.isPending && <p className="text-muted-foreground">Đang tải đoạn…</p>}
      {probe.isError && <p className="text-destructive">Không tải được đoạn nghe.</p>}
      {/* Mounted only once the clips are here: the tape is built from them on its first render,
          so a run started with an empty list would never get one. */}
      {probe.data && probe.data.clips.length > 0 && <TapeRunner clips={probe.data.clips} />}
      {probe.data && probe.data.clips.length === 0 && <p className="text-destructive">Ngân hàng chưa có đoạn nào đã duyệt.</p>}
    </section>
  );
}

type ProbeClip = z.infer<typeof probeSchema>["clips"][number];

function TapeRunner({ clips }: { clips: ProbeClip[] }) {
  const [log, setLog] = useState<string[]>([]);
  const note = (e: TapeEvent) => setLog((l) => [...l, tapeLogLine(e, new Date())]);
  const tape = useMixedTape();
  const current = clips[tape.index];

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Bấm Bắt đầu rồi nghe liên tục. Phải nghe đủ {clips.length} đoạn từ các đề khác nhau, không đoạn nào bị cắt ngang tiếng nói.
      </p>
      <ol className="flex flex-col gap-1 text-sm">
        {clips.map((c, i) => (
          <li key={`${c.exam}-${c.number}`} className={i === tape.index ? "font-semibold" : "text-muted-foreground"}>
            {i + 1}. <span lang="ko">{c.exam}</span> · Câu {c.number} · {formatDuration(c.end_ms - c.start_ms)} (hết tiếng{" "}
            {formatDuration(c.speech_end_ms - c.start_ms)})
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        {/* Straight from the tap: both elements are unlocked while the gesture is still live. */}
        <Button type="button" onClick={() => void tape.start(clips, note)}>
          Bắt đầu
        </Button>
        <Button type="button" variant="outline" onClick={tape.toggle}>
          {tape.playing ? "Tạm dừng" : "Tiếp tục"}
        </Button>
        <Button type="button" variant="ghost" onClick={tape.stop}>
          Dừng hẳn
        </Button>
      </div>

      <p className="font-mono text-sm tabular-nums">
        Đoạn {tape.index + 1}/{clips.length} · {formatDuration(tape.positionMs)}
        {current ? ` / ${formatDuration(current.end_ms - current.start_ms)}` : ""}
        {tape.waiting ? " · ĐANG CHỜ NẠP" : ""}
        {tape.finished ? " · HẾT BĂNG" : ""}
        {tape.pauseCount > 0 ? ` · tạm dừng ${tape.pauseCount} lần` : ""}
      </p>

      <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap">{log.join("\n") || "(chưa có gì)"}</pre>
    </>
  );
}
