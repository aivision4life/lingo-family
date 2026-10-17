import { Camera } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TOPIK_IMAGE_MAX_BYTES, TOPIK_IMAGE_MAX_SIDE, TOPIK_OPTION_COUNT, type TopikContent, type TopikQuestionInput } from "@shared/topik";
import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { imageUrl } from "@/features/images/api";
import { resizeForUpload } from "@/features/images/resize";
import { useUploadTopikImage } from "./api";
import { toTopikInput, type TopikFormValues } from "./formValues";

const TOPIK_IMAGE_LIMITS = { maxSide: TOPIK_IMAGE_MAX_SIDE, maxBytes: TOPIK_IMAGE_MAX_BYTES };

/** A text-and/or-image field: a text input plus an optional photo (TOPIK's own size limit, M6.1). */
function ContentField({
  id,
  label,
  value,
  onChange,
  profileId,
  autoFocus,
}: {
  id: string;
  label: string;
  value: TopikContent;
  onChange: (v: TopikContent) => void;
  profileId: string;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const upload = useUploadTopikImage();
  const file = useRef<HTMLInputElement>(null);
  const [zoomed, setZoomed] = useState(false);

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    const blob = await resizeForUpload(f, TOPIK_IMAGE_LIMITS).catch(() => null);
    if (!blob) return;
    upload.mutate({ profileId, blob }, { onSuccess: ({ image_key }) => onChange({ ...value, image_key }) });
  };

  return (
    <FormField id={id} label={label}>
      <div className="flex flex-col gap-2">
        <Textarea
          id={id}
          autoFocus={autoFocus}
          rows={3}
          value={value.text ?? ""}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
        />
        <div className="flex items-center gap-2">
          {value.image_key && (
            <button type="button" onClick={() => setZoomed(true)} className="shrink-0">
              <img src={imageUrl(value.image_key)} alt={t("topik.manage.form.viewImage")} className="h-24 w-24 rounded border object-cover" />
            </button>
          )}
          <Button type="button" variant="outline" size="sm" disabled={upload.isPending} onClick={() => file.current?.click()}>
            <Camera aria-hidden />
            {t("topik.manage.form.photo")}
          </Button>
          {value.image_key && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...value, image_key: null })}>
              {t("topik.manage.form.removePhoto")}
            </Button>
          )}
        </div>
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {value.image_key && (
        <Dialog open={zoomed} onOpenChange={setZoomed}>
          <DialogContent className="max-w-[calc(100%-1rem)] p-2 sm:max-w-2xl">
            <DialogTitle className="sr-only">{t("topik.manage.form.viewImage")}</DialogTitle>
            <img src={imageUrl(value.image_key)} alt={t("topik.manage.form.viewImage")} className="max-h-[85vh] w-full object-contain" />
          </DialogContent>
        </Dialog>
      )}
    </FormField>
  );
}

type Props = {
  profileId: string;
  initial: TopikFormValues;
  submitting: boolean;
  serverError?: string | null;
  onSubmit: (input: TopikQuestionInput) => void;
  /** Create mode only: shows a second "Save and add next" button next to "Save". */
  onSubmitAndNext?: (input: TopikQuestionInput) => void;
  /** Shown above the buttons, e.g. "Đã lưu câu N" after a successful "save and add next". */
  savedMessage?: string | null;
  footer?: React.ReactNode;
};

/** Manual add/edit form for one TOPIK question (M6.1, a simple fallback next to the .docx import). */
export function TopikQuestionForm({ profileId, initial, submitting, serverError, onSubmit, onSubmitAndNext, savedMessage, footer }: Props) {
  const { t } = useTranslation();
  const [values, setValues] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const set = <K extends keyof TopikFormValues>(key: K, value: TopikFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  const validate = (): TopikQuestionInput | null => {
    const input = toTopikInput(values);
    setInvalid(!input);
    return input;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = validate();
    if (input) onSubmit(input);
  };

  const submitAndNext = () => {
    const input = validate();
    if (input) onSubmitAndNext?.(input);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormField id="tq-exam" label={t("topik.manage.form.exam")}>
        <Input id="tq-exam" value={values.exam} onChange={(e) => set("exam", e.target.value)} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField id="tq-number" label={t("topik.manage.form.number")}>
          <Input id="tq-number" type="number" inputMode="numeric" value={values.number} onChange={(e) => set("number", e.target.value)} />
        </FormField>
        <FormField id="tq-block" label={t("topik.manage.form.block")}>
          <Input id="tq-block" value={values.block} onChange={(e) => set("block", e.target.value)} />
        </FormField>
      </div>
      <FormField id="tq-instruction" label={t("topik.manage.form.instruction")}>
        <Input id="tq-instruction" value={values.instruction} onChange={(e) => set("instruction", e.target.value)} />
      </FormField>
      <ContentField id="tq-stem" label={t("topik.manage.form.stem")} value={values.stem} onChange={(v) => set("stem", v)} profileId={profileId} autoFocus />
      <div role="radiogroup" aria-label={t("topik.manage.form.correctOption")} className="flex flex-col gap-3">
        {Array.from({ length: TOPIK_OPTION_COUNT }, (_, i) => i + 1).map((n) => (
          <div key={n} className="flex items-center gap-2">
            <input
              type="radio"
              id={`tq-correct-${n}`}
              name="correct_option"
              className="size-5"
              checked={values.correct_option === n}
              onChange={() => set("correct_option", n)}
            />
            <label htmlFor={`tq-correct-${n}`} className="font-medium">{n})</label>
            <div className="flex-1">
              <ContentField
                id={`tq-option-${n}`}
                label=""
                value={values.options[n - 1]!}
                onChange={(v) => set("options", values.options.map((o, i) => (i === n - 1 ? v : o)) as TopikFormValues["options"])}
                profileId={profileId}
              />
            </div>
          </div>
        ))}
      </div>
      {invalid && <p role="alert" className="text-sm text-destructive">{t("topik.manage.form.invalid")}</p>}
      {serverError && <p role="alert" className="text-sm text-destructive">{serverError}</p>}
      {savedMessage && <p role="status" className="text-sm text-green-700 dark:text-green-400">{savedMessage}</p>}
      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? t("topik.manage.form.saving") : t("topik.manage.form.save")}
        </Button>
        {onSubmitAndNext && (
          <Button type="button" variant="outline" size="lg" disabled={submitting} onClick={submitAndNext}>
            {submitting ? t("topik.manage.form.saving") : t("topik.manage.form.saveAndNext")}
          </Button>
        )}
      </div>
      {footer}
    </form>
  );
}
