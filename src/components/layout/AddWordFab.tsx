import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";

/** Phones only: floating "+" (add word) above the bottom tab bar. Hidden for kid profiles. */
export function AddWordFab() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  if (!canManageProfiles(profile)) return null;

  return (
    <Link
      to="/words/new"
      aria-label={t("nav.addWord")}
      title={t("nav.addWord")}
      className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:hidden"
    >
      <Plus className="size-7" aria-hidden />
    </Link>
  );
}
