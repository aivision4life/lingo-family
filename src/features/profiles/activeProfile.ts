import { createContext, useContext } from "react";
import type { Profile } from "@shared/profile";

export type ActiveProfileState = {
  /** Profile in use on this device, or null if none is selected (or it was deleted). */
  profile: Profile | null;
  profiles: Profile[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  selectProfile: (id: string) => void;
  clearProfile: () => void;
};

export const ActiveProfileContext = createContext<ActiveProfileState | null>(null);

export function useActiveProfile(): ActiveProfileState {
  const ctx = useContext(ActiveProfileContext);
  if (!ctx) throw new Error("useActiveProfile must be used inside <ProfileProvider>");
  return ctx;
}

/** Kid profiles cannot create, edit or delete profiles or change settings. */
export const canManageProfiles = (profile: Profile | null) => !profile?.is_kid;
