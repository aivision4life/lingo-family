import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Square } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { wordErrorMessage } from "@/features/words/format";
import { backfillStep, useBackfillStatus } from "./api";

type Phase = { kind: "idle" } | { kind: "running"; term: string | null } | { kind: "done" | "stopped" | "quota" } | { kind: "error"; message: string };

/**
 * Settings: "Create images for older words". Calls the backfill endpoint one word at a time
 * (each call draws inside the request) until nothing is left, the quota is used up or Stop.
 */
export function BackfillCard({ profileId }: { profileId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const status = useBackfillStatus();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [drawn, setDrawn] = useState(0);
  const stop = useRef(false);
  const running = phase.kind === "running";

  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["usage"] }), qc.invalidateQueries({ queryKey: ["words"] }), qc.invalidateQueries({ queryKey: ["phrases"] })]);

  const start = async () => {
    stop.current = false;
    setDrawn(0);
    setPhase({ kind: "running", term: null });
    try {
      for (;;) {
        if (stop.current) return setPhase({ kind: "stopped" });
        const r = await backfillStep(profileId);
        setDrawn((n) => n + r.drawn);
        void refresh();
        if (r.quota) return setPhase({ kind: "quota" });
        if (!r.word) return setPhase({ kind: "done" });
        setPhase({ kind: "running", term: r.word.term });
      }
    } catch (err) {
      setPhase({ kind: "error", message: wordErrorMessage(err, t) ?? t("words.errors.generic") });
    } finally {
      void refresh();
    }
  };

  const remaining = status.data?.remaining;
  const message =
    phase.kind === "running" ? (phase.term ? t("images.backfill.working", { term: phase.term }) : t("images.drawing"))
    : phase.kind === "done" ? t("images.backfill.done")
    : phase.kind === "stopped" ? t("images.backfill.stopped")
    : phase.kind === "quota" ? t("images.backfill.quota")
    : phase.kind === "error" ? phase.message
    : null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">{t("images.backfill.title")}</h2>
      {remaining !== undefined && (
        <p className="text-sm">{remaining > 0 ? t("images.backfill.remaining", { count: remaining }) : t("images.backfill.none")}</p>
      )}
      {running ? (
        <Button variant="outline" onClick={() => (stop.current = true)}>
          <Square aria-hidden />
          {t("images.backfill.stop")}
        </Button>
      ) : (
        <Button variant="secondary" disabled={!remaining} onClick={() => void start()}>
          <ImagePlus aria-hidden />
          {t("images.backfill.start")}
        </Button>
      )}
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message} {drawn > 0 && t("images.backfill.drawn", { count: drawn })}
        </p>
      )}
    </section>
  );
}
