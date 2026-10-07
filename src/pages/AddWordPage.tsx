import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import type { ExampleLevel, LearnLang } from "@shared/enums";
import { enrichRequestSchema } from "@shared/word";
import { LangText } from "@/components/LangText";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { duplicateIdOf, useCreateWord, useEnrichWord } from "@/features/words/api";
import { wordErrorMessage } from "@/features/words/format";
import { draftFromEnrichment, draftToCreateInput, emptyDraft, type DraftErrors, type WordDraft } from "@/features/words/draft";
import { DraftFields } from "@/features/words/DraftFields";
import { ExamplesEditor } from "@/features/words/ExamplesEditor";
import { TermStep } from "@/features/words/TermStep";

/** Screen 5 — add a word: term → AI enrich (or manual) → review/edit → save (F2, F6). */
export function AddWordPage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();

  if (!profile) return null;
  if (!canManageProfiles(profile)) {
    return (
      <PageShell title={t("words.add.title")}>
        <p>{t("profiles.kidNotAllowed")}</p>
      </PageShell>
    );
  }
  return (
    <AddWord
      profileId={profile.id}
      defaultLang={profile.study_langs[0] ?? "ko"}
      defaultLevel={profile.is_kid ? "kid" : "beginner"}
    />
  );
}

type AddWordProps = { profileId: string; defaultLang: LearnLang; defaultLevel: ExampleLevel };

function AddWord({ profileId, defaultLang, defaultLevel }: AddWordProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const enrich = useEnrichWord();
  const create = useCreateWord();

  const [lang, setLang] = useState<LearnLang>(defaultLang);
  const [term, setTerm] = useState("");
  const [level, setLevel] = useState<ExampleLevel>(defaultLevel);
  const [termError, setTermError] = useState(false);
  // null = still on the term step; otherwise the editable draft.
  const [draft, setDraft] = useState<WordDraft | null>(null);
  const [aiFilled, setAiFilled] = useState(false);
  const [cached, setCached] = useState(false);
  const [errors, setErrors] = useState<DraftErrors>({});

  const request = () => {
    const parsed = enrichRequestSchema.safeParse({ profile_id: profileId, lang, term, level });
    setTermError(!parsed.success);
    return parsed.success ? parsed.data : null;
  };

  const aiFill = () => {
    const req = request();
    if (!req) return;
    enrich.mutate(req, {
      onSuccess: (res) => {
        setTerm(req.term);
        setDraft(draftFromEnrichment(res.enrichment));
        setAiFilled(true);
        setCached(res.cached);
      },
    });
  };

  const manual = () => {
    const req = request();
    if (!req) return;
    enrich.reset();
    setTerm(req.term);
    setDraft(emptyDraft());
    setAiFilled(false);
    setCached(false);
  };

  const save = () => {
    if (!draft) return;
    const result = draftToCreateInput(draft, { profileId, lang, term, level, aiFilled });
    setErrors(result.errors ?? {});
    if (result.input) create.mutate(result.input, { onSuccess: ({ id }) => void navigate(`/words/${id}`) });
  };

  const errorNotice = (error: unknown) => {
    const message = wordErrorMessage(error, t);
    if (!message) return null;
    const existingId = duplicateIdOf(error);
    return (
      <div role="alert" className="flex flex-col gap-2 text-sm text-destructive">
        <p>{message}</p>
        {existingId && (
          <Link to={`/words/${existingId}`} className="font-medium underline underline-offset-4">
            {t("words.errors.openExisting")}
          </Link>
        )}
      </div>
    );
  };

  if (!draft) {
    return (
      <PageShell title={t("words.add.title")}>
        <TermStep
          lang={lang}
          term={term}
          level={level}
          onLangChange={setLang}
          onTermChange={setTerm}
          onLevelChange={setLevel}
          onAiFill={aiFill}
          onManual={manual}
          enriching={enrich.isPending}
          termError={termError ? t("words.errors.term") : undefined}
          notice={errorNotice(enrich.error)}
        />
      </PageShell>
    );
  }

  return (
    <PageShell title={t("words.add.title")}>
      <div className="flex items-center justify-between gap-3">
        <LangText lang={lang} className="text-4xl font-bold">
          {term}
        </LangText>
        <Button variant="outline" onClick={() => setDraft(null)}>
          {t("words.add.changeTerm")}
        </Button>
      </div>
      {aiFilled && (
        <p className="text-sm text-muted-foreground">
          {t("words.add.aiReview")} {cached && t("words.add.cached")}
        </p>
      )}
      <DraftFields
        lang={lang}
        draft={draft}
        errors={errors}
        aiFilled={aiFilled}
        onChange={(patch) => setDraft({ ...draft, ...patch })}
      />
      <ExamplesEditor lang={lang} examples={draft.examples} onChange={(examples) => setDraft({ ...draft, examples })} />
      {errorNotice(create.error)}
      <Button size="lg" disabled={create.isPending} onClick={save}>
        {create.isPending ? t("words.add.saving") : t("words.add.save")}
      </Button>
    </PageShell>
  );
}
