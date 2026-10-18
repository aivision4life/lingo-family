import { BookOpen, ClipboardCheck, GraduationCap, House, Settings, type LucideIcon } from "lucide-react";

export type NavItem = {
  to: string;
  labelKey: "nav.home" | "nav.review" | "nav.topik" | "nav.words" | "nav.settings";
  icon: LucideIcon;
  /** Kid profiles never see this item (and the page itself turns them away). */
  adultOnly?: boolean;
};

/**
 * Main navigation, shared by the desktop sidebar and the mobile tab bar.
 * Reserved: a "Hanja" item (F7, e.g. icon `Languages`, route `/hanja`) goes after "words" in M4;
 * the tab bar builds one grid column per visible item, so it adapts automatically.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: "/home", labelKey: "nav.home", icon: House },
  { to: "/review", labelKey: "nav.review", icon: GraduationCap },
  // TOPIK II is an advanced-learner exam, and a practice session has the server generate its
  // vocabulary/explanations — an AI feature, which kid profiles never get (SPEC §10).
  { to: "/topik", labelKey: "nav.topik", icon: ClipboardCheck, adultOnly: true },
  { to: "/words", labelKey: "nav.words", icon: BookOpen },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
];

/** The items this profile may see. Pure, so the tab bar and the sidebar cannot drift apart. */
export const visibleNavItems = (isKid: boolean): NavItem[] => NAV_ITEMS.filter((item) => !(item.adultOnly && isKid));
