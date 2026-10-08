import { RefreshCw } from "lucide-react";
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
import { isRetryableAiError, wordErrorMessage } from "@/features/words/format";
import { readLastAddLang, saveLastAddLang } from "@/features/words/langGuess";
import { draftFromEnrichment, draftToCreateInput, emptyDraft, type DraftErrors, type WordDraft } from "@/features/words/draft";
import { DraftFields } from "@/features/words/DraftFields";
import { ExamplesEditor } from "@/features/words/ExamplesEditor";
import { TermStep } from "@/features/words/TermStep";
import { draftFromSuggestion, selectedPhraseInputs, type PhraseDraft, type PhraseDraftErrors } from "@/features/phrases/phraseDraft";
import { PhraseSuggestionList } from "@/features/phrases/PhraseSuggestionList";

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

  // The last language chosen on this device wins over the profile default.
  const [lang, setLang] = useState<LearnLang>(() => readLastAddLang() ?? defaultLang);
  const [term, setTerm] = useState("");
  const [level, setLevel] = useState<ExampleLevel>(defaultLevel);
  const [termError, setTermError] = useState(false);
  // null = still on the term step; otherwise the editable draft.
  const [draft, setDraft] = useState<WordDraft | null>(null);
  const [aiFilled, setAiFilled] = useState(false);
  const [cached, setCached] = useState(false);
  const [errors, setErrors] = useState<DraftErrors>({});
  // AI-suggested phrases (unticked by default); only ticked ones are saved.
  const [phraseDrafts, setPhraseDrafts] = useState<PhraseDraft[]>([]);
  const [phraseErrors, setPhraseErrors] = useState<Record<string, PhraseDraftErrors>>({});

  const changeLang = (l: LearnLang) => {
    setLang(l);
    saveLastAddLang(l);
  };

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
        setPhraseDrafts(res.enrichment.phrases.map(draftFromSuggestion));
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
    setPhraseDrafts([]);
    setAiFilled(false);
    setCached(false);
  };

  const save = () => {
    if (!draft) return;
    const result = draftToCreateInput(draft, { profileId, lang, term, level, aiFilled });
    const phrases = selectedPhraseInputs(phraseDrafts, level);
    setErrors(result.errors ?? {});
    setPhraseErrors(phrases.errors);
    if (result.input && phrases.ok) {
      create.mutate(
        { ...result.input, phrases: phrases.inputs },
        {
          // Word detail shows light notices for missing audio and for phrases that already existed.
          onSuccess: ({ id, audio, skipped_phrases }) =>
            void navigate(`/words/${id}`, { state: { audioMissing: audio.missing, skippedPhrases: skipped_phrases } }),
        },
      );
    }
  };

  // The typed term and the chosen language/level stay as they are, so "Try again" resends them.
  const errorNotice = (error: unknown, onRetry?: () => void) => {
    const message = wordErrorMessage(error, t);
    if (!message) return null;
    const existingId = duplicateIdOf(error);
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
        <p>{message}</p>
        {existingId && (
          <Link to={`/words/${existingId}`} className="font-medium underline underline-offset-4">
            {t("words.errors.openExisting")}
          </Link>
        )}
        {onRetry && isRetryableAiError(error) && (
          <Button type="button" variant="outline" onClick={onRetry}>
            <RefreshCw aria-hidden />
            {t("common.retry")}
          </Button>
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
          onLangChange={changeLang}
          onTermChange={setTerm}
          onLevelChange={setLevel}
          onAiFill={aiFill}
          onManual={manual}
          enriching={enrich.isPending}
          termError={termError ? t("words.errors.term") : undefined}
          notice={enrich.isPending ? null : errorNotice(enrich.error, aiFill)}
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
      {phraseDrafts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("phrases.suggested")}</h2>
          <p className="text-sm text-muted-foreground">{t("phrases.suggestedHint")}</p>
          <PhraseSuggestionList lang={lang} drafts={phraseDrafts} errors={phraseErrors} onChange={setPhraseDrafts} />
        </section>
      )}
      {errorNotice(create.error)}
      <Button size="lg" disabled={create.isPending} onClick={save}>
        {create.isPending ? t("words.add.saving") : t("words.add.save")}
      </Button>
    </PageShell>
  );
}
