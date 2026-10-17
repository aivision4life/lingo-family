import { Search } from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { TopikQuestion } from "@shared/topik";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDeleteTopikQuestion, useGenerateTopikContent, useTopikFacets, useTopikQuestionContent, useTopikQuestionsPaged, useVerifyTopikBulk } from "./api";
import { truncate } from "./questionPreview";

type Filter = "unverified" | "verified" | "all";

type Props = { profileId: string; onAddNew: () => void; onEdit: (q: TopikQuestion) => void };

/** Review screen's list (M6.1, filters/search/pagination added as the bank grows toward ~600+
 * rows): tabs + exam/block dropdowns (scoped to the active tab) + a content/number search box. */
export function TopikQuestionList({ profileId, onAddNew, onEdit }: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("unverified");
  const [exam, setExam] = useState("");
  const [block, setBlock] = useState("");
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim());

  const verified = filter === "all" ? undefined : filter === "verified";
  const changeFilter = (f: Filter) => {
    setFilter(f);
    // An exam/block only meaningful in one tab (e.g. a fully-approved exam) must not silently
    // narrow the other tab to zero rows.
    setExam("");
    setBlock("");
  };

  const facets = useTopikFacets(profileId, verified);
  const questions = useTopikQuestionsPaged(profileId, { verified, exam: exam || undefined, block: block || undefined, q: q || undefined });
  const del = useDeleteTopikQuestion();
  const verifyBulk = useVerifyTopikBulk();

  const rows = questions.data?.pages.flatMap((p) => p.questions) ?? [];
  const total = questions.data?.pages[0]?.total ?? 0;
  const exams = [...new Set(rows.map((r) => r.exam))];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {(["unverified", "verified", "all"] as const).map((f) => (
          <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => changeFilter(f)}>
            {t(`topik.manage.filter.${f}`)}
          </Button>
        ))}
        <Button variant="secondary" size="sm" className="ms-auto" onClick={onAddNew}>
          {t("topik.manage.addManual")}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={exam}
          onChange={(e) => setExam(e.target.value)}
          aria-label={t("topik.manage.filterExam")}
          className="min-h-11 rounded-lg border bg-background px-3 text-sm"
        >
          <option value="">{t("topik.manage.filterExam")}</option>
          {facets.data?.exams.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <select
          value={block}
          onChange={(e) => setBlock(e.target.value)}
          aria-label={t("topik.manage.filterBlock")}
          className="min-h-11 rounded-lg border bg-background px-3 text-sm"
        >
          <option value="">{t("topik.manage.filterBlock")}</option>
          {facets.data?.blocks.map((b) => (
            <option key={b} value={b}>
              {t("topik.blockLabel", { block: b })}
            </option>
          ))}
        </select>
      </div>

      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("topik.manage.searchPlaceholder")}
          aria-label={t("topik.manage.searchPlaceholder")}
          className="pl-10"
        />
      </div>

      {questions.isPending ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : questions.isError ? (
        <p className="text-destructive">{t("common.loadError")}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">{t("topik.manage.empty")}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("topik.manage.resultCount", { count: total })}</p>
          {exams.map((examLabel) => {
            const examRows = rows.filter((r) => r.exam === examLabel);
            const anyUnverified = examRows.some((r) => !r.verified);
            return (
              <div key={examLabel} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold">{examLabel}</h2>
                  {anyUnverified && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={verifyBulk.isPending}
                      onClick={() => verifyBulk.mutate({ profile_id: profileId, exam: examLabel })}
                    >
                      {t("topik.manage.verifyGroup")}
                    </Button>
                  )}
                </div>
                {examRows.map((question) => (
                  <QuestionRow
                    key={question.id}
                    question={question}
                    profileId={profileId}
                    onEdit={() => onEdit(question)}
                    onDelete={() => del.mutate({ id: question.id, profile_id: profileId })}
                    deleting={del.isPending}
                  />
                ))}
              </div>
            );
          })}
          {questions.hasNextPage && (
            <Button
              variant="outline"
              disabled={questions.isFetchingNextPage}
              onClick={() => void questions.fetchNextPage()}
            >
              {questions.isFetchingNextPage ? t("common.loading") : t("topik.manage.loadMore")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function QuestionRow({
  question,
  profileId,
  onEdit,
  onDelete,
  deleting,
}: {
  question: TopikQuestion;
  profileId: string;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const { t } = useTranslation();
  const preview = question.stem.text ? truncate(question.stem.text, 40) : t("topik.manage.imageOnly");
  return (
    <div className="flex items-start justify-between gap-2 rounded-md border p-2">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm text-muted-foreground">
          {question.exam} · #{question.number} {!question.verified && `· ${t("topik.manage.unverifiedBadge")}`}{" "}
          {question.warning && `· ⚠ ${question.warning}`}
        </span>
        <span lang="ko" className="truncate">
          {preview}
        </span>
        <span className="text-sm text-muted-foreground">{t("topik.manage.correctAnswer", { n: question.correct_option })}</span>
        <AiStatus question={question} profileId={profileId} />
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="outline" onClick={onEdit}>
          {t("topik.manage.edit")}
        </Button>
        <Button size="sm" variant="destructive" disabled={deleting} onClick={onDelete}>
          {t("topik.manage.delete")}
        </Button>
      </div>
    </div>
  );
}

/** How long to keep polling after a manual "Tạo dữ liệu AI" click before giving up and showing the
 * button again (a permanent Gemini failure — e.g. the account's own daily quota, not this app's —
 * would otherwise poll forever with no way to retry); comfortably above the LLM client's own ~100s
 * retry budget (see CLAUDE.md's Gemini retry note). */
const GENERATE_TIMEOUT_MS = 120_000;

/** Per-question vocab/explanation status (M6.4-ish: generation now happens lazily, at practice time, so
 * most rows start out with neither) + a "Tạo dữ liệu AI" button to fill in a leftover one by hand
 * without waiting for a real practice session. Polls after a click until both are ready, then
 * invalidates the list so the row picks up the fresh `vocab_ready`/`explain_ready` from the server. */
function AiStatus({ question, profileId }: { question: TopikQuestion; profileId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const generate = useGenerateTopikContent();
  const [triggered, setTriggered] = useState(false);
  const needsGeneration = !question.vocab_ready || !question.explain_ready;
  const poll = useTopikQuestionContent(question.id, profileId, triggered && needsGeneration);
  const polledReady = poll.data?.vocab_ready && poll.data?.explain_ready;

  useEffect(() => {
    if (triggered && polledReady) void qc.invalidateQueries({ queryKey: ["topik"] });
  }, [triggered, polledReady, qc]);

  // A real timer, not a derived value — give up and let the adult retry instead of polling forever.
  useEffect(() => {
    if (!triggered) return;
    const timer = setTimeout(() => setTriggered(false), GENERATE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [triggered]);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>{t(question.vocab_ready ? "topik.manage.status.vocabReady" : "topik.manage.status.vocabPending")}</span>
      <span>{t(question.explain_ready ? "topik.manage.status.explainReady" : "topik.manage.status.explainPending")}</span>
      {needsGeneration &&
        (triggered ? (
          <span>{t("topik.manage.aiGenerating")}</span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={generate.isPending}
            onClick={() => {
              setTriggered(true);
              generate.mutate({ id: question.id, profileId });
            }}
          >
            {t("topik.manage.generateAi")}
          </Button>
        ))}
    </div>
  );
}
