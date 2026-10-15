import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { ProfileAvatar } from "@/features/profiles/ProfileAvatar";
import { cn } from "@/lib/utils";

/** Active profile's avatar (+ name); opens the profile picker. */
export function ProfileButton({ showName = true, className }: { showName?: boolean; className?: string }) {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();

  return (
    <Link
      to="/profiles"
      aria-label={t("nav.switchProfile")}
      title={showName ? undefined : profile?.name}
      className={cn(
        "flex min-h-11 min-w-11 items-center gap-2 rounded-md px-2 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      {profile && <ProfileAvatar profile={profile} variant="nav" />}
      {showName && <span className="max-w-32 truncate font-medium">{profile?.name}</span>}
    </Link>
  );
}
