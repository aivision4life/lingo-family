import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./navItems";
import { ProfileButton } from "./ProfileButton";

// Collapsed/expanded is a per-device preference.
const COLLAPSED_KEY = "sidebar_collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Desktop (≥ 768px) navigation: profile at the top, items, collapse toggle at the bottom. */
export function Sidebar() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      } catch {
        // Ignore: the choice just won't persist.
      }
      return !c;
    });
  };

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col gap-2 border-r bg-background p-3 md:flex",
        collapsed ? "w-[4.5rem]" : "w-60",
      )}
    >
      <ProfileButton showName={!collapsed} className={collapsed ? "justify-center" : undefined} />
      {!collapsed && <span className="px-2 text-sm font-bold text-muted-foreground">{t("app.name")}</span>}

      <nav aria-label={t("nav.main")} className="mt-2 flex-1">
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                // Collapsed: icon only, the label stays available as tooltip + accessible name.
                title={collapsed ? t(labelKey) : undefined}
                aria-label={collapsed ? t(labelKey) : undefined}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-11 items-center gap-3 rounded-md px-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    collapsed && "justify-center px-0",
                    isActive ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:bg-accent/60",
                  )
                }
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                {!collapsed && t(labelKey)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
        title={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
          collapsed && "justify-center px-0",
        )}
      >
        {collapsed ? <PanelLeftOpen className="size-5" aria-hidden /> : <PanelLeftClose className="size-5" aria-hidden />}
        {!collapsed && t("nav.collapseSidebar")}
      </button>
    </aside>
  );
}
