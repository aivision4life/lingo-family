import { imageUrl } from "@/features/images/api";
import { cn } from "@/lib/utils";

type Props = {
  profile: { avatar: string; avatar_photo: string | null };
  /** "tile" fills a relative square parent (ProfileTile); "nav" is a small inline circle (nav bar). */
  variant: "tile" | "nav";
};

/** The uploaded photo (M2.10) when set, otherwise the chosen emoji. */
export function ProfileAvatar({ profile, variant }: Props) {
  if (profile.avatar_photo) {
    return (
      <img
        src={imageUrl(profile.avatar_photo)}
        alt=""
        className={cn("object-cover", variant === "tile" ? "absolute inset-0 size-full rounded-[inherit]" : "size-7 rounded-full")}
      />
    );
  }
  return (
    <span aria-hidden className={variant === "nav" ? "text-2xl" : undefined}>
      {profile.avatar}
    </span>
  );
}
