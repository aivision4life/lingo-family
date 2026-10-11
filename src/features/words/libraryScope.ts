// Library scope filter (M2.7): "learning" (I have a card) | "mine" (I added it) | "all".
// The choice is remembered per profile, per device (localStorage). Pure helpers, unit tested.
import { LIBRARY_SCOPES, type LibraryScope } from "@shared/enums";

const KEY_PREFIX = "library_scope_";

/** Default for a profile that has never chosen: "learning" (SPEC M2.7), for every profile type. */
export const DEFAULT_SCOPE: LibraryScope = "learning";

export const isLibraryScope = (v: unknown): v is LibraryScope => (LIBRARY_SCOPES as readonly string[]).includes(v as string);

/** A stored value, or null (never chosen / corrupted), to DEFAULT_SCOPE otherwise unchanged. */
export const parseScope = (stored: string | null): LibraryScope => (isLibraryScope(stored) ? stored : DEFAULT_SCOPE);

export function readScope(profileId: string): LibraryScope {
  try {
    return parseScope(localStorage.getItem(KEY_PREFIX + profileId));
  } catch {
    return DEFAULT_SCOPE;
  }
}

export function writeScope(profileId: string, scope: LibraryScope) {
  try {
    localStorage.setItem(KEY_PREFIX + profileId, scope);
  } catch {
    // The choice just won't persist (private mode, quota).
  }
}
