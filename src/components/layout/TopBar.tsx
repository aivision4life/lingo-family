import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useActiveProfile } from "@/features/profiles/activeProfile";

export function TopBar() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();

  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
        <Link to="/home" className="mr-auto flex min-h-11 items-center text-lg font-bold">
          {t("app.name")}
        </Link>
        {/* Active profile's avatar; tapping it opens the profile picker. */}
        <Button asChild variant="ghost" className="gap-2 px-2" aria-label={t("nav.switchProfile")}>
          <Link to="/profiles">
            <span className="text-2xl" aria-hidden>
              {profile?.avatar}
            </span>
            <span className="max-w-28 truncate">{profile?.name}</span>
          </Link>
        </Button>
      </div>
    </header>
  );
}
