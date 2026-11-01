import { Dialog as DialogPrimitive } from "radix-ui";
import { useTranslation } from "react-i18next";

/**
 * One picture, full screen, closed by tapping it again (M7.2).
 *
 * The whole surface is the close button rather than a small × in a corner: this opens because
 * someone wanted a closer look at a drawing, so the next tap is always "I'm done looking". Escape
 * and the back gesture work through the dialog as usual.
 */
export function TopikImageZoom({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  const { t } = useTranslation();

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content className="fixed inset-0 z-[70] bg-background outline-none">
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{t("topik.practice.zoomClose")}</DialogPrimitive.Description>
          <DialogPrimitive.Close
            className="flex h-full w-full items-center justify-center p-2 outline-none"
            aria-label={t("topik.practice.zoomClose")}
          >
            <img src={src} alt={label} className="max-h-full max-w-full object-contain" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
