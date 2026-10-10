// Who sees the "add word" shortcuts, and where. Pure functions, unit tested.

type ProfileLike = { is_kid: boolean } | null | undefined;

/** Only adult profiles add words (kids browse the library). No profile → nothing. */
export const canAddWords = (profile: ProfileLike): boolean => !!profile && !profile.is_kid;

/** Screens that show the floating "+" on phones: Home and the Library. */
const FAB_PATHS = ["/home", "/words"];

export function showAddWordFab(profile: ProfileLike, pathname: string): boolean {
  if (!canAddWords(profile)) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return FAB_PATHS.includes(path);
}

/** The "+ Add word" button at the top of the Library: always shown to adults, on every screen size. */
export const showAddWordButton = canAddWords;
