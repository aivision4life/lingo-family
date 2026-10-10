import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PHRASE_ERRORS, type Phrase } from "@shared/phrase";
import type { UiLang } from "@shared/enums";
import { LangText } from "@/components/LangText";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { SpeakButton } from "@/features/audio/AudioButtons";
import { FocusTap } from "@/features/focus/FocusTap";
import { focusKey } from "@/features/focus/focusItems";
import { ImageTools } from "@/features/images/ImageTools";
import { ItemImage } from "@/features/images/ItemImage";
import { AiBadge } from "@/features/words/bits";
import { ExampleItem } from "@/features/words/ExampleItem";
import { glossFor } from "@/features/words/format";
import { ApiError } from "@/lib/api";
import { useDeletePhrase, useUpdatePhrase } from "./api";
import { draftFromPhrase, phraseDraftToInput, type PhraseDraftErrors } from "./phraseDraft";
import { PhraseFields } from "./PhraseFields";

type Props = {
  phrase: Phrase;
  glossLang: UiLang;
  /** Adult profile id when editing is allowed, else null (kids only listen). */
  editorId: string | null;
};

/** One phrase on Word detail: audio, meaning, its example; adults can edit or delete it. */
export function PhraseItem({ phrase, glossLang, editorId }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftFromPhrase(phrase));
  const [errors, setErrors] = useState<PhraseDraftErrors>({});
  const update = useUpdatePhrase();
  const del = useDeletePhrase();
  const ex = phrase.examples[0];

  const save = () => {
    if (!editorId) return;
    const r = phraseDraftToInput(draft, ex?.level ?? "beginner");
    setErrors(r.errors ?? {});
    if (!r.input) return;
    // Extra fields (ai_generated, emoji) are ignored by the PATCH schema.
    update.mutate({ id: phrase.id, patch: { profile_id: editorId, ...r.input } }, { onSuccess: () => setEditing(false) });
  };

  const duplicateOf =
    update.error instanceof ApiError && update.error.code === PHRASE_ERRORS.duplicate
      ? String((update.error.body as { existing_word_term?: unknown } | null)?.existing_word_term ?? "")
      : null;

  if (editing) {
    return (
      <li className="flex flex-col gap-3 rounded-lg border p-3">
        <PhraseFields lang={phrase.lang} draft={draft} errors={errors} onChange={(p) => setDraft({ ...draft, ...p })} />
        {duplicateOf !== null && <p role="alert" className="text-sm text-destructive">{t("phrases.duplicate", { word: duplicateOf })}</p>}
        {update.isError && duplicateOf === null && <p role="alert" className="text-sm text-destructive">{t("words.errors.generic")}</p>}
        <div className="flex gap-2">
          <Button onClick={save} disabled={update.isPending}>{t("phrases.save")}</Button>
          <Button variant="outline" onClick={() => { setDraft(draftFromPhrase(phrase)); setEditing(false); }}>
            {t("common.cancel")}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <FocusTap focusKey={focusKey("phrase", phrase.id)} text={phrase.text} className="shrink-0">
          <ItemImage kind="phrase" id={phrase.id} image={phrase} alt={glossFor(phrase, glossLang)} emoji={phrase.emoji} size="small" />
        </FocusTap>
        <FocusTap focusKey={focusKey("phrase", phrase.id)} text={phrase.text} className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-col">
            <span className="flex flex-wrap items-baseline gap-2">
              <LangText lang={phrase.lang} className="text-xl font-semibold">{phrase.text}</LangText>
              <span className="text-sm text-muted-foreground">{phrase.reading}</span>
              {phrase.ai_generated && !phrase.verified && <AiBadge />}
            </span>
            <span lang={glossLang}>{glossFor(phrase, glossLang)}</span>
          </div>
        </FocusTap>
        <SpeakButton audioKey={phrase.audio_key} label={t("phrases.play", { text: phrase.text })} />
        {editorId && (
          <>
            <Button variant="ghost" size="icon" aria-label={t("phrases.edit", { text: phrase.text })} onClick={() => setEditing(true)}>
              <Pencil className="size-5" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t("phrases.delete", { text: phrase.text })} disabled={del.isPending}>
                  <Trash2 className="size-5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("phrases.deleteTitle", { text: phrase.text })}</AlertDialogTitle>
                  <AlertDialogDescription>{t("phrases.deleteDescription")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => del.mutate({ id: phrase.id, profileId: editorId })}>
                    {t("words.delete.confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
      <ImageTools kind="phrase" id={phrase.id} image={phrase} suggestion={phrase.gloss_en} compact />
      {ex && (
        <div className="border-t pt-2">
          <ExampleItem ex={ex} lang={phrase.lang} glossLang={glossLang} audioLabel={t("phrases.playExample", { text: phrase.text })} />
        </div>
      )}
      {del.isError && <p role="alert" className="text-sm text-destructive">{t("words.errors.generic")}</p>}
    </li>
  );
}
