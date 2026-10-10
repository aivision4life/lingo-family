import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { showAddWordFab } from "./addWordVisibility";

/**
 * Phones only: floating "+" (add word) above the bottom tab bar, on Home and the Library, for
 * adult profiles. It is rendered by AppLayout (outside the page content, so no page container can
 * clip or shift it). Bottom = tab bar (3.5rem + the safe area under it) + a 1rem gap; right keeps
 * clear of rounded corners / notches.
 */
export function AddWordFab() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const { pathname } = useLocation();
  if (!showAddWordFab(profile, pathname)) return null;

  return (
    <Link
      to="/words/new"
      aria-label={t("nav.addWord")}
      title={t("nav.addWord")}
      className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:hidden"
    >
      <Plus className="size-7" aria-hidden />
    </Link>
  );
}
