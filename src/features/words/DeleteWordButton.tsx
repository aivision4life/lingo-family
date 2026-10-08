import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { WordDetail } from "@shared/word";
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
import { useDeleteWord } from "@/features/phrases/api";

/** Adults: delete a word with its phrases and all profiles' cards (review history is kept). */
export function DeleteWordButton({ word, profileId }: { word: WordDetail; profileId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const del = useDeleteWord();

  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" className="text-destructive" disabled={del.isPending}>
            <Trash2 aria-hidden />
            {t("words.delete.button")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("words.delete.title", { term: word.term })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("words.delete.description", { phrases: word.phrases.length, cards: word.card_count })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                del.mutate({ id: word.id, profileId }, { onSuccess: () => void navigate("/words", { replace: true }) })
              }
            >
              {t("words.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {del.isError && <p role="alert" className="text-sm text-destructive">{t("words.errors.generic")}</p>}
    </>
  );
}
