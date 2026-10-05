import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  title: string;
  /** Milestone that will implement this screen, e.g. "M1". Shows a "coming soon" note. */
  milestone?: string;
  children?: ReactNode;
};

/** Common page frame: heading, optional "coming soon" note, then a column of actions/content. */
export function PageShell({ title, milestone, children }: Props) {
  const { t } = useTranslation();

  return (
    <section className="mx-auto w-full max-w-2xl space-y-6 p-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      {milestone && <p className="text-muted-foreground">{t("common.comingSoon", { milestone })}</p>}
      {children && <div className="flex flex-col gap-3">{children}</div>}
    </section>
  );
}
