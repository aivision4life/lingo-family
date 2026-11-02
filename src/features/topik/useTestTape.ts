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
 */
export function useTestTape(span: Span) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [positionMs, setPositionMs] = useState(span?.start_ms ?? 0);
  const [playing, setPlaying] = useState(false);
  const [pauseCount, setPauseCount] = useState(0);
  const [pausedMs, setPausedMs] = useState(0);
  const pausedAt = useRef<number | null>(null);

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
    const start = () => {
      el.currentTime = startMs / 1000;
      void el.play().catch(() => setPlaying(false));
      setPlaying(true);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", start);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      // Removed too, or a cleaned-up element starts playing the moment its metadata arrives — an
      // orphan tape nobody can pause, running underneath the real one.
      el.removeEventListener("loadedmetadata", start);
      el.pause();
      audio.current = null;
    };
  }, [audioKey, startMs]);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      // Time spent paused is wall-clock time the learner had to think, so it is measured and
      // reported rather than quietly folded into the duration.
      if (pausedAt.current !== null) setPausedMs((ms) => ms + (Date.now() - pausedAt.current!));
      pausedAt.current = null;
      void el.play().catch(() => undefined);
      setPlaying(true);
    } else {
      el.pause();
      pausedAt.current = Date.now();
      setPauseCount((n) => n + 1);
      setPlaying(false);
    }
  }, []);

  const stop = useCallback(() => {
    audio.current?.pause();
    setPlaying(false);
  }, []);

  return { positionMs, playing, pauseCount, pausedMs, toggle, stop };
}
