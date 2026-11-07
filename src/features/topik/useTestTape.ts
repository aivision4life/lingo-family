import { useCallback, useEffect, useRef, useState } from "react";
import { mediaUrl } from "@/features/audio/player";

type Span = { audio_key: string; start_ms: number; end_ms: number } | null;

/**
 * The exam tape (M6.4): one `<audio>` playing one span of one file, start to finish.
 *
 * Its own element rather than the app's shared player, because the rules are the opposite of
 * everywhere else — nothing may stop it, replay it or change its speed, and a stray tap on a word
 * somewhere else in the app must not take it over. Pausing is allowed (the learner studies in the
 * evening after work, and blocking it would just mean abandoning the paper), but every pause is
 * counted, and the result says the sitting was not under exam conditions.
 *
 * It does not start by itself (M7.13). It is started by `playFrom(offsetMs)` — from the tap that
 * begins the paper, or, when a sitting is reopened, from the tap that resumes it, with the offset
 * the server's clock says the tape should be at. A phone only lets a page play audio a real gesture
 * asked for, so there is nothing to be gained by trying earlier.
 */
export function useTestTape(span: Span) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [positionMs, setPositionMs] = useState(span?.start_ms ?? 0);
  const [playing, setPlaying] = useState(false);
  /** Where to start once the file's metadata is in, so a tap during loading is not lost. */
  const pendingFrom = useRef<number | null>(null);

  // Keyed on the primitives, not on `span` itself: the sitting is refetched (answers are saved as
  // they are given), and a new object with the same values must not tear the tape down and start
  // the paper again from the first clip.
  const audioKey = span?.audio_key ?? "";
  const startMs = span?.start_ms ?? 0;
  useEffect(() => {
    if (!audioKey) return;
    const el = new Audio(mediaUrl(audioKey));
    audio.current = el;
    const onTime = () => setPositionMs(el.currentTime * 1000);
    const seekAndPlay = () => {
      if (pendingFrom.current === null) return;
      el.currentTime = (startMs + pendingFrom.current) / 1000;
      pendingFrom.current = null;
      void el.play().catch(() => setPlaying(false));
      setPlaying(true);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", seekAndPlay);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      // Removed too, or a cleaned-up element starts playing the moment its metadata arrives — an
      // orphan tape nobody can pause, running underneath the real one.
      el.removeEventListener("loadedmetadata", seekAndPlay);
      el.pause();
      audio.current = null;
    };
  }, [audioKey, startMs]);

  /** Start (or resume) the tape `offsetMs` into the paper, counting from the span's own start. */
  const playFrom = useCallback(
    (offsetMs: number) => {
      const el = audio.current;
      pendingFrom.current = Math.max(0, offsetMs);
      // `readyState >= 1` means the duration is known, which is when a seek will actually stick.
      if (el && el.readyState >= 1) {
        el.currentTime = (startMs + pendingFrom.current) / 1000;
        pendingFrom.current = null;
        void el.play().catch(() => setPlaying(false));
        setPlaying(true);
      }
    },
    [startMs],
  );

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => undefined);
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }, []);

  const stop = useCallback(() => {
    audio.current?.pause();
    setPlaying(false);
  }, []);

  return { positionMs, playing, playFrom, toggle, stop };
}
