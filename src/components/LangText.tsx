import type { ComponentProps } from "react";
import type { LearnLang } from "@shared/enums";
import { HTML_LANG } from "@/lib/htmlLang";

type Props = Omit<ComponentProps<"span">, "lang"> & { lang: LearnLang };

/** Text in a learning language, tagged with the right `lang` attribute. */
export function LangText({ lang, ...props }: Props) {
  return <span lang={HTML_LANG[lang]} {...props} />;
}
