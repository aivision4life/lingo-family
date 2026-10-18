import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { cn } from "@/lib/utils";
import { visibleNavItems } from "./navItems";

/** Mobile tab bar at the bottom of the screen; hidden on desktop (≥ 768px). */
export function BottomNav() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const items = visibleNavItems(!!profile?.is_kid);

  return (
    <nav
      aria-label={t("nav.main")}
      className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {/* Inline columns, not a grid-cols-N class: the item count depends on the profile. */}
      <ul className="mx-auto grid max-w-2xl" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map(({ to, labelKey, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[0.6875rem] leading-tight",
                  isActive ? "font-semibold text-foreground" : "text-muted-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn("size-5", isActive && "stroke-[2.5]")} aria-hidden />
                  {t(labelKey)}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
