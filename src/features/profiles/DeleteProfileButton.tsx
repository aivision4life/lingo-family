import { useTranslation } from "react-i18next";
import type { Profile } from "@shared/profile";
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
import { useDeleteProfile } from "./api";
import { profileErrorMessage } from "./errors";

type Props = { profile: Profile; onDeleted: () => void };

export function DeleteProfileButton({ profile, onDeleted }: Props) {
  const { t } = useTranslation();
  const del = useDeleteProfile();
  const error = profileErrorMessage(del.error, t);

  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="ghost" className="text-destructive" disabled={del.isPending}>
            {t("profiles.delete.button")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("profiles.delete.title", { name: profile.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t("profiles.delete.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => del.mutate(profile.id, { onSuccess: onDeleted })}
            >
              {t("profiles.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
