import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { setUiLang } from "@/i18n";
import { ActiveProfileContext, type ActiveProfileState } from "./activeProfile";
import { useProfiles } from "./api";

// The last selected profile is remembered per device and opened automatically on start.
const STORAGE_KEY = "active_profile_id";

function readStoredId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore: the choice just won't persist.
  }
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const query = useProfiles();
  const [activeId, setActiveId] = useState<string | null>(readStoredId);

  const profiles = useMemo(() => query.data ?? [], [query.data]);
  const profile = profiles.find((p) => p.id === activeId) ?? null;

  // The UI language follows the active profile, and changes as soon as its ui_lang changes.
  const uiLang = profile?.ui_lang;
  useEffect(() => {
    if (uiLang) setUiLang(uiLang);
  }, [uiLang]);

  const selectProfile = useCallback((id: string) => {
    setActiveId(id);
    storeId(id);
  }, []);

  const clearProfile = useCallback(() => {
    setActiveId(null);
    storeId(null);
  }, []);

  const value: ActiveProfileState = {
    profile,
    profiles,
    isLoading: query.isPending,
    isError: query.isError,
    refetch: () => void query.refetch(),
    selectProfile,
    clearProfile,
  };

  return <ActiveProfileContext value={value}>{children}</ActiveProfileContext>;
}
