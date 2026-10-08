import { BookOpen, GraduationCap, House, Settings, type LucideIcon } from "lucide-react";

export type NavItem = {
  to: string;
  labelKey: "nav.home" | "nav.review" | "nav.words" | "nav.settings";
  icon: LucideIcon;
};

/**
 * Main navigation, shared by the desktop sidebar and the mobile tab bar.
 * Reserved: a "Hanja" item (F7, e.g. icon `Languages`, route `/hanja`) goes after "words" in M4;
 * the tab bar uses one grid column per item, so it adapts automatically.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: "/home", labelKey: "nav.home", icon: House },
  { to: "/review", labelKey: "nav.review", icon: GraduationCap },
  { to: "/words", labelKey: "nav.words", icon: BookOpen },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
];
