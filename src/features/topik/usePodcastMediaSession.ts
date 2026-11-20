// Puts the podcast on the lock screen and the car's head unit (SPEC F13, M8.2).
//
// Only the wiring: every decision — which button does what, what the system is told the podcast is
// doing, what it is called — is made by the pure functions in `podcastMediaSession.ts`, which are
// tested. Nothing here can be tested, because there is no Media Session in a test environment and
// no head unit either; keeping it this thin is what makes that acceptable.
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { PodcastQuestion } from "@shared/podcast";
import {
  PODCAST_MEDIA_ACTIONS,
  podcastCommandFor,
  podcastNowPlaying,
  podcastPlaybackState,
  type PodcastControlState,
} from "./podcastMediaSession";
import type { PodcastTape } from "./podcastTape";

export type PodcastControls = { toggle: () => void; jumpTo: (index: number) => void; stop: () => void };

/** The browser's own session, or nothing where there is none (older Safari, a test run). */
const mediaSession = () => (typeof navigator === "undefined" ? undefined : navigator.mediaSession);

export function usePodcastMediaSession(
  tape: PodcastTape,
  questions: readonly PodcastQuestion[],
  state: PodcastControlState,
  controls: PodcastControls,
) {
  const { t } = useTranslation();
  const { started, playing, finished, index } = state;
  // Held in a ref so that a new object every render does not tear the handlers down and build
  // them again; what the handlers must never go stale on is the state, and that is in the deps.
  const latest = useRef({ controls, tape });
  // Declared before the handlers below, so it is already up to date when they are rebuilt.
  useEffect(() => {
    latest.current = { controls, tape };
  });

  useEffect(() => {
    const session = mediaSession();
    if (!session) return;
    for (const action of PODCAST_MEDIA_ACTIONS) {
      try {
        session.setActionHandler(action, () => {
          const { controls: c, tape: tp } = latest.current;
          const command = podcastCommandFor(action, tp, { started, playing, finished, index });
          if (command.kind === "toggle") c.toggle();
          else if (command.kind === "jump") c.jumpTo(command.index);
          else if (command.kind === "stop") c.stop();
        });
      } catch {
        // A browser refuses the actions it does not implement; the rest still work.
      }
    }
    return () => {
      for (const action of PODCAST_MEDIA_ACTIONS) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // Nothing to undo if it was never accepted.
        }
      }
    };
  }, [started, playing, finished, index]);

  useEffect(() => {
    const session = mediaSession();
    if (!session) return;
    // Right through the gap as well: a head unit told "paused" draws a stopped podcast, and may
    // give the audio to something else.
    session.playbackState = podcastPlaybackState({ started, playing, finished });

    const now = podcastNowPlaying(tape, questions, index);
    if (!started || !now || typeof MediaMetadata === "undefined") return;
    session.metadata = new MediaMetadata({
      // "Câu 7 · 60회", and underneath it the piece being read: the two things a listener who
      // cannot look at the screen needs.
      title: t("topik.podcast.nowPlaying", { n: now.number, exam: now.exam }),
      artist: t(`topik.podcast.step.${now.step}`),
      album: t("topik.podcast.title"),
      artwork: [{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }],
    });
  }, [tape, questions, started, playing, finished, index, t]);
}
