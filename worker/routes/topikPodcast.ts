// The TOPIK listening podcast (SPEC F13, M8.1): studying with the ears alone.
//
// Read-only, every one of these routes. A podcast reads the answer out loud, so it writes nothing
// at all — not FSRS, not `topik_attempts`, not even a "heard it" mark (F13: nobody answered
// anything, and a listener who dozed off looks exactly like one who got it right).
//
// Two rules shape what comes back:
//  - the **original clip is never replaced by TTS** — a question without one is left out, and the
//    screen says how many were left out and why;
//  - across every paper, a question this profile has never answered is **kept for a mock test**
//    (M7.27) — the podcast reads answers aloud, so burning a first sitting on one would be worse
//    here than anywhere else. One paper chosen by name is the deliberate way round it, exactly as
//    in practice.
import { and, asc, gte, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { podcastQuerySchema } from "../../shared/podcast";
import { TOPIK_MAX_GROUP_SPAN, topikGroupsOf } from "../../shared/topik";
import { splitReservedForTests } from "../../shared/topikAnswered";
import { expandToGroups } from "../../shared/topikRange";
import { topik_questions } from "../../db/schema";
import { getDb, type AppEnv } from "../env";
import { zv } from "../lib/validate";
import { answeredQuestionIds } from "../services/topikAnswered";
import { buildPodcastPlaylist, readPodcastManifest, type PodcastRow } from "../services/topikPodcast";
import { voiceFor } from "../services/tts";
import { clipsBySegment, practisable } from "./topik";

export function topikPodcastRoutes() {
  return (
    new Hono<AppEnv>()
      /**
       * The papers a podcast can be built from, and how far their numbering goes — what the
       * picker needs before anything is chosen. Listening only: there is nothing to listen to in
       * the reading section, and reading a passage aloud would break the TTS rule by another door.
       */
      .get("/topik/podcast/papers", zv("query", z.object({ profile_id: z.string().min(1) })), async (c) => {
        const db = getDb(c.env);
        const rows = await db
          .select({ exam: topik_questions.exam, questions: sql<number>`count(*)`, max_number: sql<number>`max(${topik_questions.number})` })
          .from(topik_questions)
          .where(practisable("listening"))
          .groupBy(topik_questions.exam)
          .orderBy(asc(topik_questions.exam));

        return c.json({
          papers: rows.map((r) => ({ exam: r.exam, questions: Number(r.questions), max_number: Number(r.max_number) })),
          max_number: rows.reduce((m, r) => Math.max(m, Number(r.max_number)), 0),
        });
      })

      /**
       * The playlist itself — also what the picker reads to say what a selection really holds,
       * since the counts and the tape have to come from the same decision or they will disagree.
       */
      .get("/topik/podcast", zv("query", podcastQuerySchema), async (c) => {
        const { profile_id, exam, from, to } = c.req.valid("query");
        const db = getDb(c.env);

        // The range is widened to whole groups first (M7.24), seen through a window wide enough to
        // hold a group that straddles the edge.
        const inWindow = await db
          .select({
            id: topik_questions.id,
            exam: topik_questions.exam,
            number: topik_questions.number,
            instruction: topik_questions.instruction,
            options: topik_questions.options,
            correct_option: topik_questions.correct_option,
            segment_id: topik_questions.segment_id,
            group_key: topik_questions.group_key,
          })
          .from(topik_questions)
          .where(
            and(
              practisable("listening", exam),
              gte(topik_questions.number, Math.max(1, from - TOPIK_MAX_GROUP_SPAN)),
              lte(topik_questions.number, to + TOPIK_MAX_GROUP_SPAN),
            ),
          )
          .orderBy(asc(topik_questions.number));

        const range = expandToGroups({ from, to }, topikGroupsOf(inWindow));
        const inRange = inWindow.filter((q) => q.number >= range.from && q.number <= range.to);

        // Every paper reserves what has never been answered; one paper chosen by name does not.
        const reserved =
          exam === undefined
            ? new Set(splitReservedForTests(inRange, await answeredQuestionIds(db, profile_id, "listening")).reserved.map((q) => q.id))
            : new Set<string>();

        const [clips, generated] = await Promise.all([
          clipsBySegment(
            db,
            inRange.map((q) => q.segment_id).filter((id): id is string => id !== null),
          ),
          readPodcastManifest(c.env.MEDIA),
        ]);

        const playlist = await buildPodcastPlaylist({
          rows: inRange as PodcastRow[],
          clips,
          reserved,
          generated,
          voice: voiceFor(c.env, "ko"),
        });
        return c.json({ ...playlist, from: range.from, to: range.to, expanded: range.expanded });
      })
  );
}
