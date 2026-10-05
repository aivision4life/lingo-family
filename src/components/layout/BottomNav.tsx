import { BookOpen, House, Layers, Settings, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  labelKey: "nav.home" | "nav.words" | "nav.decks" | "nav.settings";
  icon: LucideIcon;
};

const ITEMS: NavItem[] = [
  { to: "/home", labelKey: "nav.home", icon: House },
  { to: "/words", labelKey: "nav.words", icon: BookOpen },
  { to: "/decks", labelKey: "nav.decks", icon: Layers },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
];

export function BottomNav() {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t("nav.main")}
      className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto grid max-w-2xl grid-cols-4">
        {ITEMS.map(({ to, labelKey, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs",
                  isActive ? "font-semibold text-foreground" : "text-muted-foreground",
                )
              }
            >
              <Icon className="size-5" aria-hidden />
              {t(labelKey)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
