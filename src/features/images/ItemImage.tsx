import { ImageIcon, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ImageItemKind, ImageView } from "@shared/image";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { cn } from "@/lib/utils";
import { imageUrl, isStalePending, useEnsureImage } from "./api";

const SIZES = {
  thumb: "size-12 rounded-md text-3xl",
  small: "size-20 rounded-md text-4xl",
  medium: "size-32 rounded-lg text-6xl",
  large: "aspect-square w-full max-w-80 rounded-xl text-8xl",
} as const;

type Props = {
  kind: ImageItemKind;
  id: string;
  image: ImageView;
  /** The item's meaning in the profile's gloss language (alt text). */
  alt: string;
  /** Placeholder while there is no image (pending, failed, not drawn yet). */
  emoji?: string | null;
  size: keyof typeof SIZES;
  /** Example sentences: draw the image the first time it is displayed (SPEC F3). */
  lazy?: boolean;
  className?: string;
};

/**
 * Picture of a word / phrase / example: the image when ready (lazy-loaded), otherwise the emoji
 * placeholder with a spinner while drawing. Asks the server to draw a lazy example image, or to
 * take over a stalled drawing, at most once per mount.
 */
export function ItemImage({ kind, id, image, alt, emoji, size, lazy = false, className }: Props) {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const ensure = useEnsureImage({ kind, id });
  const asked = useRef(false);
  const [broken, setBroken] = useState(false);

  const wantsDrawing = (lazy && image.image_status === "none" && kind === "example") || isStalePending(image);
  useEffect(() => {
    if (!wantsDrawing || !profile || asked.current) return;
    asked.current = true;
    ensure.mutate(profile.id);
  }, [wantsDrawing, profile, ensure]);

  const drawing = image.image_status === "pending" || ensure.isPending;
  const box = cn("relative flex shrink-0 items-center justify-center overflow-hidden bg-muted", SIZES[size], className);

  if (image.image_key && !broken) {
    return (
      <div className={box}>
        <img
          src={imageUrl(image.image_key)}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => setBroken(true)}
        />
        {drawing && <Spinner label={t("images.drawing")} />}
      </div>
    );
  }
  return (
    <div className={box} role="img" aria-label={alt}>
      {emoji ? <span aria-hidden>{emoji}</span> : <ImageIcon aria-hidden className="size-1/3 text-muted-foreground" />}
      {drawing && <Spinner label={t("images.drawing")} />}
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <span className="absolute right-1 bottom-1 rounded-full bg-background/80 p-0.5" role="status">
      <LoaderCircle aria-hidden className="size-4 animate-spin" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
