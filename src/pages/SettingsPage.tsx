import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";
import { BackfillCard } from "@/features/images/BackfillCard";
import { UsageCard } from "@/features/images/UsageCard";
import { BuildInfo } from "@/features/pwa/BuildInfo";
import { InstallCard } from "@/features/pwa/InstallCard";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { useUpdateProfile } from "@/features/profiles/api";
import { profileErrorMessage } from "@/features/profiles/errors";
import { formValuesFromProfile } from "@/features/profiles/formValues";
import { ProfileForm } from "@/features/profiles/ProfileForm";

/** Screen 10 — settings of the active profile. Kid profiles cannot change settings. */
export function SettingsPage() {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const update = useUpdateProfile();
  const [saved, setSaved] = useState(false);
  // Bumped after each save so the form re-initialises from the fresh profile (clears PIN inputs).
  const [formVersion, setFormVersion] = useState(0);

  // RequireProfile guarantees an active profile here.
  if (!profile) return null;

  if (!canManageProfiles(profile)) {
    return (
      <PageShell title={t("pages.settings.title")}>
        <p>{t("profiles.kidNotAllowed")}</p>
      </PageShell>
    );
  }

  return (
    <PageShell title={t("pages.settings.title")}>
      <ProfileForm
        key={`${profile.id}-${formVersion}`}
        mode="edit"
        hasPin={profile.has_pin}
        initial={formValuesFromProfile(profile)}
        submitting={update.isPending}
        serverError={profileErrorMessage(update.error, t)}
        onSubmit={(patch) => {
          setSaved(false);
          // On success the profile list refreshes and the UI language follows the new ui_lang.
          update.mutate({ id: profile.id, patch }, {
            onSuccess: () => {
              setSaved(true);
              setFormVersion((v) => v + 1);
            },
          });
        }}
        footer={
          saved && (
            <p role="status" className="text-center text-sm text-muted-foreground">
              {t("profiles.form.saved")}
            </p>
          )
        }
      />
      <LinkButton to="/profiles" variant="outline">
        {t("pages.settings.manageProfiles")}
      </LinkButton>
      <InstallCard />
      <UsageCard profileId={profile.id} />
      <BackfillCard profileId={profile.id} />
      <BuildInfo />
    </PageShell>
  );
}
