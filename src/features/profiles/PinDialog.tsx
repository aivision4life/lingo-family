import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PIN_LENGTH, type Profile } from "@shared/profile";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { checkPin } from "./api";

type Props = {
  /** Profile being unlocked; the dialog is open while this is set. */
  profile: Profile | null;
  onCancel: () => void;
  onSuccess: (profile: Profile) => void;
};

export function PinDialog({ profile, onCancel, onSuccess }: Props) {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const [wrong, setWrong] = useState(false);
  const [checking, setChecking] = useState(false);

  const close = () => {
    setPin("");
    setWrong(false);
    onCancel();
  };

  // Checked automatically as soon as 4 digits are typed.
  const onChange = async (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(digits);
    setWrong(false);
    if (!profile || digits.length < PIN_LENGTH) return;

    setChecking(true);
    try {
      const ok = await checkPin(profile.id, digits);
      if (ok) {
        setPin("");
        onSuccess(profile);
      } else {
        setPin("");
        setWrong(true);
      }
    } catch {
      setPin("");
      setWrong(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Dialog open={profile !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent showCloseButton={false} className="max-w-xs">
        <DialogHeader>
          <DialogTitle>{t("profiles.pin.title", { name: profile?.name ?? "" })}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="off"
          aria-label={t("profiles.pin.label")}
          aria-invalid={wrong}
          // readOnly (not disabled) keeps focus, so a wrong PIN can be retyped right away.
          readOnly={checking}
          value={pin}
          onChange={(e) => void onChange(e.target.value)}
          className="h-14 text-center text-3xl tracking-[0.5em]"
        />
        {wrong && (
          <p role="alert" className="text-sm text-destructive">
            {t("profiles.pin.wrong")}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
