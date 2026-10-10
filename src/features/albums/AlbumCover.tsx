import { LibraryBig } from "lucide-react";
import { useState } from "react";
import type { AlbumCover as Cover } from "@shared/album";
import { imageUrl } from "@/features/images/api";
import { cn } from "@/lib/utils";

/** Square album cover: the cover word's image, else its emoji, else a generic icon. */
export function AlbumCover({ cover, name, className }: { cover: Cover; name: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  const box = cn("relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-muted text-6xl", className);

  if (cover?.image_key && cover.image_status === "ready" && !broken) {
    return (
      <div className={box}>
        <img src={imageUrl(cover.image_key)} alt={name} loading="lazy" decoding="async" className="size-full object-cover" onError={() => setBroken(true)} />
      </div>
    );
  }
  return (
    <div className={box} role="img" aria-label={name}>
      {cover?.emoji ? <span aria-hidden>{cover.emoji}</span> : <LibraryBig aria-hidden className="size-1/3 text-muted-foreground" />}
    </div>
  );
}
