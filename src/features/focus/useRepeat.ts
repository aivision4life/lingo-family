import { useEffect, useRef, useState } from "react";
import { onAudioEnded, playAudio } from "@/features/audio/player";
import { createRepeater } from "./repeater";

/** Repeat button state for one sound; the loop ends by itself when the sound changes or the view closes. */
export function useRepeat(audioKey: string | null) {
  const [repeating, setRepeating] = useState(false);
  const repeater = useRef<ReturnType<typeof createRepeater> | null>(null);

  useEffect(() => {
    if (!audioKey) return;
    const r = createRepeater({
      play: () => playAudio(audioKey),
      subscribeEnded: onAudioEnded,
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (h) => window.clearTimeout(h as number),
      onChange: setRepeating,
    });
    repeater.current = r;
    return () => {
      r.stop();
      repeater.current = null;
    };
  }, [audioKey]);

  return { repeating, toggle: () => repeater.current?.toggle() };
}
