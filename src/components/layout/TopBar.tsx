import { UsersRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "./LanguageSwitcher";

export function TopBar() {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
        <Link to="/home" className="mr-auto flex min-h-11 items-center text-lg font-bold">
          {t("app.name")}
        </Link>
        <LanguageSwitcher />
        <Button asChild variant="ghost" size="icon" aria-label={t("nav.switchProfile")}>
          <Link to="/">
            <UsersRound className="size-5" />
          </Link>
        </Button>
      </div>
    </header>
  );
}
