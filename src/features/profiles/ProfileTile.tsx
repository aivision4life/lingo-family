import { Lock, Pencil, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Profile } from "@shared/profile";
import { cn } from "@/lib/utils";
import { ProfileAvatar } from "./ProfileAvatar";

type TileProps = {
  label: string;
  ariaLabel?: string;
  onClick: () => void;
  highlighted?: boolean;
  children: ReactNode;
  footer?: ReactNode;
};

/** Square avatar button + name, Netflix style. */
function Tile({ label, ariaLabel, onClick, highlighted, children, footer }: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="group flex flex-col items-center gap-2 rounded-xl p-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span
        className={cn(
          "relative flex aspect-square w-full items-center justify-center rounded-2xl bg-muted text-6xl transition-transform group-hover:scale-105",
          highlighted && "ring-4 ring-primary",
        )}
      >
        {children}
      </span>
      <span className="max-w-full truncate text-base font-medium">{label}</span>
      {footer}
    </button>
  );
}

type ProfileTileProps = {
  profile: Profile;
  isActive: boolean;
  managing: boolean;
  onClick: () => void;
};

export function ProfileTile({ profile, isActive, managing, onClick }: ProfileTileProps) {
  const { t } = useTranslation();

  return (
    <Tile
      label={profile.name}
      ariaLabel={managing ? t("profiles.edit", { name: profile.name }) : undefined}
      onClick={onClick}
      highlighted={isActive}
      footer={
        profile.is_kid && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{t("profiles.kidBadge")}</span>
        )
      }
    >
      <ProfileAvatar profile={profile} variant="tile" />
      {profile.has_pin && !managing && (
        <>
          <Lock className="absolute right-2 bottom-2 size-5 text-muted-foreground" aria-hidden />
          <span className="sr-only">{t("profiles.hasPin")}</span>
        </>
      )}
      {managing && (
        <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40">
          <Pencil className="size-8 text-white" aria-hidden />
        </span>
      )}
    </Tile>
  );
}

export function AddProfileTile({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Tile label={t("profiles.add")} onClick={onClick}>
      <Plus className="size-12 text-muted-foreground" aria-hidden />
    </Tile>
  );
}
