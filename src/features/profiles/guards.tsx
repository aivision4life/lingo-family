import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Outlet } from "react-router";
import { Button } from "@/components/ui/button";
import { useActiveProfile } from "./activeProfile";

/** Shows loading / error states until the profile list is available. */
export function ProfilesLoaded({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { isLoading, isError, refetch } = useActiveProfile();

  if (isLoading) {
    return <p className="p-8 text-center text-muted-foreground">{t("common.loading")}</p>;
  }
  if (isError) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p>{t("common.loadError")}</p>
        <Button onClick={refetch}>{t("common.retry")}</Button>
      </div>
    );
  }
  return children;
}

/** "/" — open the last used profile directly, otherwise the profile picker. */
export function RootRedirect() {
  const { profile } = useActiveProfile();
  return (
    <ProfilesLoaded>
      <Navigate to={profile ? "/home" : "/profiles"} replace />
    </ProfilesLoaded>
  );
}

/** Wraps routes that need an active profile. */
export function RequireProfile() {
  const { profile } = useActiveProfile();
  return <ProfilesLoaded>{profile ? <Outlet /> : <Navigate to="/profiles" replace />}</ProfilesLoaded>;
}
