import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { uiLangSchema } from "@shared/enums";
import { Button } from "@/components/ui/button";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { useCreateProfile, useUpdateProfile } from "@/features/profiles/api";
import { DeleteProfileButton } from "@/features/profiles/DeleteProfileButton";
import { profileErrorMessage } from "@/features/profiles/errors";
import { emptyFormValues, formValuesFromProfile } from "@/features/profiles/formValues";
import { ProfilesLoaded } from "@/features/profiles/guards";
import { ProfileForm } from "@/features/profiles/ProfileForm";

/** /profiles/new and /profiles/:id/edit — outside the main layout, reached from the picker. */
export function ProfileEditorPage() {
  return (
    <ProfilesLoaded>
      <Editor />
    </ProfilesLoaded>
  );
}

function Editor() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { profile: active, profiles } = useActiveProfile();
  const isFirst = profiles.length === 0;

  if (!canManageProfiles(active)) {
    return (
      <Frame title={t("profiles.editTitle")} canGoBack={!isFirst}>
        <p>{t("profiles.kidNotAllowed")}</p>
      </Frame>
    );
  }
  if (!id) return <CreateProfile isFirst={isFirst} />;

  const target = profiles.find((p) => p.id === id);
  return (
    <Frame title={t("profiles.editTitle")} canGoBack>
      {target ? <EditProfile key={target.id} profileId={target.id} /> : <p>{t("profiles.notFound")}</p>}
    </Frame>
  );
}

function CreateProfile({ isFirst }: { isFirst: boolean }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { selectProfile } = useActiveProfile();
  const create = useCreateProfile();
  const uiLang = uiLangSchema.catch("vi").parse(i18n.resolvedLanguage);

  return (
    <Frame title={isFirst ? t("profiles.firstTitle") : t("profiles.newTitle")} canGoBack={!isFirst}>
      {isFirst && <p className="text-muted-foreground">{t("profiles.firstHint")}</p>}
      <ProfileForm
        mode="create"
        initial={emptyFormValues(uiLang)}
        lockAdult={isFirst}
        submitting={create.isPending}
        serverError={profileErrorMessage(create.error, t)}
        onSubmit={(input) =>
          create.mutate(input, {
            onSuccess: (p) => {
              // The very first profile is opened right away; otherwise go back to the picker.
              if (isFirst) {
                selectProfile(p.id);
                void navigate("/home", { replace: true });
              } else {
                void navigate("/profiles");
              }
            },
          })
        }
      />
    </Frame>
  );
}

function EditProfile({ profileId }: { profileId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { profiles, profile: active, clearProfile } = useActiveProfile();
  const update = useUpdateProfile();
  const target = profiles.find((p) => p.id === profileId);
  if (!target) return null;

  return (
    <ProfileForm
      mode="edit"
      hasPin={target.has_pin}
      initial={formValuesFromProfile(target)}
      submitting={update.isPending}
      serverError={profileErrorMessage(update.error, t)}
      onSubmit={(patch) =>
        update.mutate({ id: target.id, patch }, { onSuccess: () => void navigate("/profiles") })
      }
      footer={
        <DeleteProfileButton
          profile={target}
          onDeleted={() => {
            if (target.id === active?.id) clearProfile();
            void navigate("/profiles", { replace: true });
          }}
        />
      }
    />
  );
}

function Frame({ title, canGoBack, children }: { title: string; canGoBack: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 p-4 pb-12">
      <div className="flex items-center gap-2">
        {canGoBack && (
          <Button variant="ghost" size="icon" aria-label={t("common.back")} onClick={() => void navigate(-1)}>
            <ArrowLeft className="size-5" />
          </Button>
        )}
        <h1 className="text-2xl font-bold">{title}</h1>
      </div>
      {children}
    </div>
  );
}
