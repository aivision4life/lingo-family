import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import type { TopikSection } from "@shared/enums";
import type { TopikMixedOption, TopikTestCreate, TopikTestOption } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/LinkButton";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { useCreateTopikTest, useTopikTestOptions } from "@/features/topik/api";
import { TestRangePicker } from "@/features/topik/TestRangePicker";
import { shortcutRange } from "@shared/topikRange";
import { topikTestStartMessage } from "@/features/topik/errors";
import { cn } from "@/lib/utils";

/**
 * Screen (M6.4, extended in M6.5) — `/topik/tests`: pick what to sit.
 *
 * Which section is on offer lives in the URL (`?section=reading`), so a chosen section survives a
 * reload and can be bookmarked. Listening is the default: it is the section that needs a real
 * sitting most, since its tape cannot be paused in the exam (M7.11).
 *
 * The mixed paper sits above the original ones, because it is the mode to reach for once a paper
 * has been sat: it draws every question from the whole bank and prefers what has not been asked
 * lately. A length the bank cannot fill is shown greyed with the reason rather than hidden —
 * "this exists, it is not ready yet" is the true state of a bank still being typed up.
 *
 * Both cards offer the same two ways in (M7.14): the three shortcut buttons, which sit a paper from
 * question 1, and a **range** below them for drilling one kind of question. The shortcuts only fill
 * a range in — the API takes nothing else — so the two cannot come to mean different things.
 */
export function TopikTestPickerPage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const [params, setParams] = useSearchParams();
  const section: TopikSection = params.get("section") === "reading" ? "reading" : "listening";
  const options = useTopikTestOptions(profile?.id ?? "", section);

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">{t("topik.test.title")}</h1>
      {/* The tape is the listening paper's clock and the reading paper has none, so even the
          blurb has to follow the section. */}
      <p className="text-sm text-muted-foreground">{t(section === "reading" ? "topik.test.introReading" : "topik.test.intro")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2" role="group" aria-label={t("topik.test.sectionLabel")}>
          {(["listening", "reading"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant={section === value ? "default" : "outline"}
              aria-pressed={section === value}
              onClick={() => setParams(value === "listening" ? {} : { section: value }, { replace: true })}
            >
              {t(`topik.section.${value}`)}
            </Button>
          ))}
        </div>
        {/* Every sitting of every paper, with the trend — the per-paper lines below only say what
            happened on that one paper. */}
        <LinkButton to="/topik/tests/history" variant="outline" className="ml-auto">
          {t("topik.history.title")}
        </LinkButton>
      </div>
      {!profile ? null : options.isPending ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : options.isError ? (
        <p className="text-destructive">{t("common.loadError")}</p>
      ) : options.data.papers.length === 0 && !options.data.mixed ? (
        <p className="text-muted-foreground">{t("topik.test.noPapers")}</p>
      ) : (
        <>
          {options.data.mixed && <MixedCard mixed={options.data.mixed} profileId={profile.id} section={section} />}
          {options.data.papers.map((paper) => (
            <PaperCard key={paper.exam} paper={paper} profileId={profile.id} section={section} />
          ))}
        </>
      )}
    </section>
  );
}

/** Starting a sitting, shared by both cards: the only difference is what goes in the body. */
function useStartTest() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateTopikTest();
  const [failure, setFailure] = useState<string | null>(null);

  const start = (body: TopikTestCreate) => {
    setFailure(null);
    create.mutate(body, {
      onSuccess: (test) => void navigate(`/topik/tests/${test.id}`),
      onError: (error) => setFailure(topikTestStartMessage(error, t)),
    });
  };
  return { start, pending: create.isPending, failure };
}

function Failure({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

/**
 * What has been sat before. Each entry names its **range** (M7.14): with ranges, "32/50" twice over
 * could be two completely different papers, and a history that cannot tell them apart is no use for
 * deciding what to drill next.
 */
function History({ entries }: { entries: TopikTestOption["history"] }) {
  const { t } = useTranslation();
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">{t("topik.test.neverTaken")}</p>;
  return (
    <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
      {entries.map((h) => (
        <li key={h.id}>
          {h.from_number !== null && h.to_number !== null
            ? t("topik.test.historyRange", {
                from: h.from_number,
                to: h.to_number,
                score: h.score_points,
                total: h.total_points,
              })
            : t("topik.test.historyScore", { score: h.score_points, total: h.total_points })}
        </li>
      ))}
    </ul>
  );
}

function MixedCard({ mixed, profileId, section }: { mixed: TopikMixedOption; profileId: string; section: TopikSection }) {
  const { t } = useTranslation();
  const { start, pending, failure } = useStartTest();

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-primary/50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{t("topik.test.mixedTitle")}</h2>
        <span className="text-sm text-muted-foreground">{t("topik.test.readyCount", { count: mixed.ready_questions })}</span>
      </div>
      <p className="text-sm text-muted-foreground">{t(section === "reading" ? "topik.test.mixedIntroReading" : "topik.test.mixedIntro")}</p>

      <div className="flex flex-wrap gap-2">
        {mixed.lengths.map((option) => (
          <div key={String(option.length)} className="flex flex-col gap-1">
            <Button
              type="button"
              variant={option.available ? "default" : "outline"}
              disabled={!option.available || pending}
              className={cn(!option.available && "opacity-50")}
              onClick={() => start({ profile_id: profileId, section, kind: "mixed", ...shortcutRange(option.questions) })}
            >
              {option.length === "full"
                ? t("topik.test.lengthFull", { count: option.questions })
                : t("topik.test.lengthN", { count: option.questions })}
            </Button>
            {!option.available && (
              <span className="max-w-32 text-xs text-muted-foreground">
                {/* The position the bank ran out at, not just "too short": that is the one question
                    whose clip is missing, which is something the owner can go and add. */}
                {option.missing_position
                  ? t("topik.test.mixedMissingAt", { position: option.missing_position })
                  : t("topik.test.tooFewQuestions", { count: mixed.reachable })}
              </span>
            )}
          </div>
        ))}
      </div>

      <TestRangePicker
        profileId={profileId}
        section={section}
        kind="mixed"
        exam={null}
        maxNumber={Math.max(1, mixed.reachable)}
        pending={pending}
        onStart={(range) => start({ profile_id: profileId, section, kind: "mixed", ...range })}
      />

      <History entries={mixed.history} />
      <Failure message={failure} />
    </div>
  );
}

function PaperCard({ paper, profileId, section }: { paper: TopikTestOption; profileId: string; section: TopikSection }) {
  const { t } = useTranslation();
  const { start, pending, failure } = useStartTest();

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold" lang="ko">
          {paper.exam}
        </h2>
        <span className="text-sm text-muted-foreground">{t("topik.test.readyCount", { count: paper.ready_questions })}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {paper.lengths.map((option) => (
          <div key={String(option.length)} className="flex flex-col gap-1">
            <Button
              type="button"
              variant={option.available ? "default" : "outline"}
              disabled={!option.available || pending}
              className={cn(!option.available && "opacity-50")}
              onClick={() => start({ profile_id: profileId, section, kind: "original", exam: paper.exam, ...shortcutRange(option.questions) })}
            >
              {option.length === "full"
                ? t("topik.test.lengthFull", { count: option.questions })
                : t("topik.test.lengthN", { count: option.questions })}
            </Button>
            {!option.available && (
              <span className="max-w-32 text-xs text-muted-foreground">
                {paper.contiguous ? t("topik.test.tooFewQuestions", { count: paper.ready_questions }) : t("topik.test.notContiguous")}
              </span>
            )}
          </div>
        ))}
      </div>

      <TestRangePicker
        profileId={profileId}
        section={section}
        kind="original"
        exam={paper.exam}
        maxNumber={Math.max(1, paper.ready_questions)}
        pending={pending}
        onStart={(range) => start({ profile_id: profileId, section, kind: "original", exam: paper.exam, ...range })}
      />

      <History entries={paper.history} />
      <Failure message={failure} />
    </div>
  );
}
