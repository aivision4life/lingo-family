import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { UI_LANGS } from "@shared/enums";
import type { WordDetail } from "@shared/word";
import { LangText } from "@/components/LangText";
import { LinkButton } from "@/components/LinkButton";
import { PageShell } from "@/components/PageShell";
import { SpeakButton, SpeedToggle } from "@/features/audio/AudioButtons";
import { AudioStatus } from "@/features/audio/AudioStatus";
import { useActiveProfile } from "@/features/profiles/activeProfile";
import { useWord } from "@/features/words/api";
import { AiBadge } from "@/features/words/bits";
import { UI_LANG_NATIVE_NAMES } from "@/i18n";

/** Screen 6 — read-only word detail (audio, images and editing come later). */
export function WordDetailPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const word = useWord(id);

  return (
    <PageShell title={t("pages.wordDetail.title")}>
      {word.isPending && <p className="text-muted-foreground">{t("common.loading")}</p>}
      {word.isError && <p>{t("words.detail.notFound")}</p>}
      {word.data && <Detail w={word.data} />}
    </PageShell>
  );
}

function Detail({ w }: { w: WordDetail }) {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const unverified = w.ai_generated && !w.verified;
  // Order the meanings so the profile's gloss language comes first.
  const glossLangs = [...UI_LANGS].sort((a, b) => Number(b === profile?.gloss_lang) - Number(a === profile?.gloss_lang));
  const firstChar = w.hanzi_simplified ? [...w.hanzi_simplified][0] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        {w.emoji && (
          <span className="text-6xl" aria-hidden>
            {w.emoji}
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1">
            <LangText lang={w.lang} className="text-5xl font-bold">
              {w.term}
            </LangText>
            <SpeakButton audioKey={w.audio_key} label={t("audio.play")} />
          </span>
          <span className="text-lg text-muted-foreground">
            {w.reading} · {t(`words.pos.${w.pos}`)}
          </span>
        </div>
      </div>

      <div className="flex justify-end">
        <SpeedToggle />
      </div>
      <AudioStatus word={w} />

      {unverified && (
        <p className="text-sm text-muted-foreground">
          <AiBadge /> {t("words.detail.notVerified")}
        </p>
      )}

      {(w.hanzi_traditional || w.han_viet) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-lg">
          {w.hanzi_traditional && (
            <>
              <dt className="text-muted-foreground">
                {w.lang === "ko" ? t("words.fields.hanja") : t("words.fields.hanzi_traditional")}
              </dt>
              <dd lang={w.lang === "ko" ? "ko" : "zh-TW"}>{w.hanzi_traditional}</dd>
            </>
          )}
          {w.lang === "ko" && w.hanzi_simplified && (
            <>
              <dt className="text-muted-foreground">{t("words.fields.hanzi_simplified")}</dt>
              <dd lang="zh-CN">{w.hanzi_simplified}</dd>
            </>
          )}
          {w.han_viet && (
            <>
              <dt className="text-muted-foreground">{t("words.fields.han_viet")}</dt>
              <dd lang="vi">{w.han_viet}</dd>
            </>
          )}
        </dl>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("words.detail.glosses")}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {glossLangs.map((l) => (
            <div key={l} className="contents">
              <dt className="text-muted-foreground" lang={l}>
                {UI_LANG_NATIVE_NAMES[l]}
              </dt>
              <dd lang={l}>{w[`gloss_${l}`]}</dd>
            </div>
          ))}
        </dl>
      </section>

      {w.examples.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("words.detail.examples")}</h2>
          <ul className="flex flex-col gap-3">
            {w.examples.map((ex, i) => (
              <li key={ex.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <LangText lang={w.lang} className="block text-xl">
                    {ex.sentence}
                  </LangText>
                  <SpeakButton audioKey={ex.audio_key} label={t("audio.playExample", { n: i + 1 })} />
                </div>
                {UI_LANGS.filter((l) => ex[`translation_${l}`]).map((l) => (
                  <p key={l} lang={l} className="text-sm text-muted-foreground">
                    {ex[`translation_${l}`]}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      <LinkButton to={`/practice/${w.id}`} variant="secondary">
        {t("pages.wordDetail.practice")}
      </LinkButton>
      {firstChar && (
        <LinkButton to={`/chars/${firstChar}`} variant="outline">
          {t("pages.wordDetail.character")}
        </LinkButton>
      )}
    </div>
  );
}
