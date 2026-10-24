import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { UI_LANGS, uiLangSchema } from "@shared/enums";
import { DAILY_NEW_LIMIT_MAX, PIN_LENGTH, type ProfileCreate, type ProfileUpdate } from "@shared/profile";
import { FormField } from "@/components/FormField";
import { NativeSelect } from "@/components/NativeSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { UI_LANG_NATIVE_NAMES } from "@/i18n";
import { toCreateInput, toUpdateInput, type FieldErrors, type FormValues } from "./formValues";
import { AvatarPicker, CardTypesPicker, StudyLangsPicker } from "./pickers";

type CommonProps = {
  initial: FormValues;
  submitting: boolean;
  /** Translated error from the server, shown above the submit button. */
  serverError?: string | null;
  /** Forces an adult profile (used for the very first profile). */
  lockAdult?: boolean;
  /** Extra actions under the form, e.g. a delete button. */
  footer?: ReactNode;
  /** Edit mode only: the "My photo" avatar control (needs the profile's id, so it's built by the caller). */
  avatarPhoto?: ReactNode;
};

type Props = CommonProps &
  (
    | { mode: "create"; onSubmit: (input: ProfileCreate) => void }
    | { mode: "edit"; hasPin: boolean; onSubmit: (input: ProfileUpdate) => void }
  );

export function ProfileForm(props: Props) {
  const { t } = useTranslation();
  const [values, setValues] = useState(props.initial);
  const [errors, setErrors] = useState<FieldErrors>({});

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const errorText = (field: keyof FieldErrors) => (errors[field] ? t(`profiles.errors.${field}`) : undefined);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (props.mode === "create") {
      const r = toCreateInput(values);
      setErrors(r.errors ?? {});
      if (r.data) props.onSubmit(r.data);
    } else {
      const r = toUpdateInput(values);
      setErrors(r.errors ?? {});
      if (r.data) props.onSubmit(r.data);
    }
  };

  const langSelect = (id: string, key: "ui_lang" | "gloss_lang") => (
    <NativeSelect
      id={id}
      value={values[key]}
      onChange={(e) => {
        const parsed = uiLangSchema.safeParse(e.target.value);
        if (parsed.success) set(key, parsed.data);
      }}
    >
      {UI_LANGS.map((lang) => (
        <option key={lang} value={lang} lang={lang}>
          {UI_LANG_NATIVE_NAMES[lang]}
        </option>
      ))}
    </NativeSelect>
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <FormField id="pf-name" label={t("profiles.form.name")} error={errorText("name")}>
        <Input
          id="pf-name"
          value={values.name}
          maxLength={30}
          autoComplete="off"
          aria-invalid={!!errors.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </FormField>

      {props.avatarPhoto && (
        <FormField id="pf-avatar-photo" label={t("profiles.form.avatarPhoto")}>
          {props.avatarPhoto}
        </FormField>
      )}

      <FormField id="pf-avatar" label={t("profiles.form.avatar")}>
        <AvatarPicker id="pf-avatar" value={values.avatar} onChange={(a) => set("avatar", a)} />
      </FormField>

      <FormField id="pf-ui-lang" label={t("profiles.form.uiLang")}>
        {langSelect("pf-ui-lang", "ui_lang")}
      </FormField>

      <FormField id="pf-gloss-lang" label={t("profiles.form.glossLang")} hint={t("profiles.form.glossLangHint")}>
        {langSelect("pf-gloss-lang", "gloss_lang")}
      </FormField>

      <FormField id="pf-study-langs" label={t("profiles.form.studyLangs")} error={errorText("study_langs")}>
        <StudyLangsPicker id="pf-study-langs" value={values.study_langs} onChange={(l) => set("study_langs", l)} />
      </FormField>

      <FormField
        id="pf-card-types"
        label={t("profiles.form.cardTypes")}
        hint={t("profiles.form.cardTypesHint")}
        error={errorText("card_types")}
      >
        <CardTypesPicker id="pf-card-types" value={values.card_types} onChange={(types) => set("card_types", types)} />
      </FormField>

      <div className="flex flex-col gap-1">
        {/* The whole row is the tap target, so the small switch still meets 44px. */}
        <label className="flex min-h-11 items-center justify-between gap-3 font-medium">
          {t("profiles.form.ownWordsOnly")}
          <Switch checked={values.own_words_only} onCheckedChange={(on) => set("own_words_only", on)} />
        </label>
        <p className="text-sm text-muted-foreground">{t("profiles.form.ownWordsOnlyHint")}</p>
      </div>

      <FormField id="pf-limit" label={t("profiles.form.dailyNewLimit")} error={errorText("daily_new_limit")}>
        <Input
          id="pf-limit"
          type="number"
          inputMode="numeric"
          min={0}
          max={DAILY_NEW_LIMIT_MAX}
          value={values.daily_new_limit}
          aria-invalid={!!errors.daily_new_limit}
          onChange={(e) => set("daily_new_limit", e.target.value)}
        />
      </FormField>

      <div className="flex flex-col gap-1">
        {/* The whole row is the tap target, so the small switch still meets 44px. */}
        <label className="flex min-h-11 items-center justify-between gap-3 font-medium">
          {t("profiles.form.isKid")}
          <Switch
            checked={values.is_kid}
            disabled={props.lockAdult}
            onCheckedChange={(checked) => set("is_kid", checked)}
          />
        </label>
        <p className="text-sm text-muted-foreground">{t("profiles.form.isKidHint")}</p>
      </div>

      {!values.is_kid && (
        <FormField
          id="pf-pin"
          label={props.mode === "edit" && props.hasPin ? t("profiles.form.pinNew") : t("profiles.form.pinOptional")}
          error={errorText("pin")}
        >
          <Input
            id="pf-pin"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={PIN_LENGTH}
            value={values.pin}
            disabled={values.removePin}
            aria-invalid={!!errors.pin}
            onChange={(e) => set("pin", e.target.value.replace(/\D/g, ""))}
          />
          {props.mode === "edit" && props.hasPin && (
            <label className="flex min-h-11 items-center justify-between gap-3">
              {t("profiles.form.removePin")}
              <Switch checked={values.removePin} onCheckedChange={(checked) => set("removePin", checked)} />
            </label>
          )}
        </FormField>
      )}

      {props.serverError && (
        <p role="alert" className="text-sm text-destructive">
          {props.serverError}
        </p>
      )}

      <Button type="submit" size="lg" disabled={props.submitting}>
        {props.submitting
          ? t("profiles.form.saving")
          : props.mode === "create"
            ? t("profiles.form.create")
            : t("profiles.form.save")}
      </Button>
      {props.footer}
    </form>
  );
}
