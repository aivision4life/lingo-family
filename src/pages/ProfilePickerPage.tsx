import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router";
import type { Profile } from "@shared/profile";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { ProfilesLoaded } from "@/features/profiles/guards";
import { PinDialog } from "@/features/profiles/PinDialog";
import { AddProfileTile, ProfileTile } from "@/features/profiles/ProfileTile";

/** Screen 1 — Netflix-style profile picker (F1). Opened from the top bar's switch button. */
export function ProfilePickerPage() {
  return (
    <ProfilesLoaded>
      <Picker />
    </ProfilesLoaded>
  );
}

function Picker() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { profile: active, profiles, selectProfile } = useActiveProfile();
  const [managing, setManaging] = useState(false);
  const [locked, setLocked] = useState<Profile | null>(null);

  if (profiles.length === 0) return <Navigate to="/profiles/new" replace />;

  const canManage = canManageProfiles(active);

  const open = (p: Profile) => {
    selectProfile(p.id);
    void navigate("/home");
  };

  const onTileClick = (p: Profile) => {
    if (managing) void navigate(`/profiles/${p.id}/edit`);
    else if (p.has_pin && p.id !== active?.id) setLocked(p);
    else open(p);
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 p-4">
      <h1 className="text-center text-3xl font-bold">{t("pages.profiles.title")}</h1>

      <div className="grid w-full max-w-md grid-cols-2 gap-6 sm:max-w-xl sm:grid-cols-3">
        {profiles.map((p) => (
          <ProfileTile
            key={p.id}
            profile={p}
            isActive={p.id === active?.id}
            managing={managing}
            onClick={() => onTileClick(p)}
          />
        ))}
        {canManage && <AddProfileTile onClick={() => void navigate("/profiles/new")} />}
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        {canManage && (
          <Button variant="outline" size="lg" onClick={() => setManaging((m) => !m)}>
            {managing ? t("profiles.doneManaging") : t("profiles.manage")}
          </Button>
        )}
        <LanguageSwitcher />
      </div>

      <PinDialog
        profile={locked}
        onCancel={() => setLocked(null)}
onSuccess={(p) => {
          setLocked(null);
          open(p);
        }}
      />
    </div>
  );
}
