import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LearnLang } from "@shared/enums";
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
import { exampleErrorKey, useDeleteExample } from "./api";
import { ExampleForm } from "./ExampleForm";

/** What the forms need to know about the word (or phrase) an example belongs to. */
export type ExampleOwner = {
  wordId: string;
  lang: LearnLang;
  profileId: string;
  /** Root word / phrase text and meaning: keeps the AI on the right sense and drives the "contains the word" warning. */
  rootTerm: string;
  rootGloss: string;
  /** Set when the example belongs to a phrase of the word. */
  phraseId?: string | null;
};

type EditableExample = { id: string; sentence: string; translation_vi: string; translation_en: string; translation_ko: string; image_prompt: string | null; ai_generated: boolean };

/** Pencil + trash of one example (adults), and the inline edit form. */
export function ExampleEditControls({ owner, example, children }: { owner: ExampleOwner; example: EditableExample; children: (controls: React.ReactNode) => React.ReactNode }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const del = useDeleteExample(example.id);

  if (editing) {
    return <ExampleForm {...owner} original={example} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />;
  }
  const controls = (
    <span className="flex shrink-0">
      <Button type="button" variant="ghost" size="icon" aria-label={t("examples.form.editNamed", { text: example.sentence })} onClick={() => setEditing(true)}>
        <Pencil className="size-5" aria-hidden />
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label={t("examples.form.deleteNamed", { text: example.sentence })} disabled={del.isPending}>
            <Trash2 className="size-5" aria-hidden />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("examples.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("examples.delete.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => del.mutate(owner.profileId)}>
              {t("examples.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
  return (
    <>
      {children(controls)}
      {del.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t(exampleErrorKey(del.error))}
        </p>
      )}
    </>
  );
}

/** "+ Add example sentence": opens the form below the button. */
export function AddExampleButton({ owner }: { owner: ExampleOwner }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (open) return <ExampleForm {...owner} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />;
  return (
    <Button type="button" variant="outline" className="self-start" onClick={() => setOpen(true)}>
      <Plus aria-hidden />
      {t("examples.form.add")}
    </Button>
  );
}
