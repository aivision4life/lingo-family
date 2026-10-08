import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ProfileButton } from "./ProfileButton";

/** Phones only (< 768px): app name + active profile in the top-right corner. */
export function TopBar() {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
      <div className="flex h-14 items-center gap-2 px-4">
        <Link to="/home" className="mr-auto flex min-h-11 items-center text-lg font-bold">
          {t("app.name")}
        </Link>
        <ProfileButton />
      </div>
    </header>
  );
}
