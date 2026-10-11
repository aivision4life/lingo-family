import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { UI_LANGS } from "@shared/enums";
import { WORD_EXAMPLES_MAX } from "@shared/exampleEdit";
import type { WordDetail } from "@shared/word";
import { LangText } from "@/components/LangText";
import { LinkButton } from "@/components/LinkButton";
import { Link } from "react-router";
import { FocusLayer } from "@/features/focus/FocusLayer";
import { itemsFromWord } from "@/features/focus/focusItems";
import { useFocusRoute } from "@/features/focus/useFocusRoute";
import { AddExampleButton, type ExampleOwner } from "@/features/examples/ExampleActions";
import { WordAlbumsButton } from "@/features/albums/WordAlbumsDialog";
import { PageShell } from "@/components/PageShell";
import { SpeakButton, SpeedToggle } from "@/features/audio/AudioButtons";
import { AudioStatus } from "@/features/audio/AudioStatus";
import { PhrasesSection } from "@/features/phrases/PhrasesSection";
import { canManageProfiles, useActiveProfile } from "@/features/profiles/activeProfile";
import { DeleteWordButton } from "@/features/words/DeleteWordButton";
import { useWord } from "@/features/words/api";
import { ImageTools } from "@/features/images/ImageTools";
import { ItemImage } from "@/features/images/ItemImage";
import { AiBadge } from "@/features/words/bits";
import { ExampleItem } from "@/features/words/ExampleItem";
import { glossFor } from "@/features/words/format";
import { UI_LANG_NATIVE_NAMES } from "@/i18n";

/** Screen 6 — word detail: picture (Redraw / My photo), audio, meanings, examples, phrases. */
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
  const firstChar = w.hanja ? [...w.hanja][0] : undefined;
  const glossLang = profile?.gloss_lang ?? "vi";
  // Tapping an example or a phrase enlarges it (M2.5); the items of this word can be swiped through.
  const exampleOwner: ExampleOwner | undefined =
    profile && canManageProfiles(profile)
      ? { wordId: w.id, lang: w.lang, profileId: profile.id, rootTerm: w.term, rootGloss: glossFor(w, glossLang) }
      : undefined;
  const focusItems = itemsFromWord(w);
  const focusRoute = useFocusRoute(focusItems);

  return (
    <FocusLayer items={focusItems} route={focusRoute} glossLang={glossLang}>
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2">
        <ItemImage kind="word" id={w.id} image={w} alt={glossFor(w, glossLang)} emoji={w.emoji} size="large" />
        <ImageTools kind="word" id={w.id} image={w} suggestion={w.gloss_en} />
      </div>
      <div className="flex items-center gap-4">
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

      {(w.albums.length > 0 || canManageProfiles(profile)) && (
        <section className="flex flex-col gap-2" aria-label={t("albums.button")}>
          {w.albums.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {w.albums.map((a) => (
                <li key={a.id}>
                  <Link to={`/albums/${a.id}`} className="inline-flex min-h-9 items-center rounded-full bg-secondary px-3 text-sm">
                    {a.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {profile && canManageProfiles(profile) && <WordAlbumsButton wordId={w.id} lang={w.lang} current={w.albums} profileId={profile.id} />}
        </section>
      )}

      <div className="flex justify-end">
        <SpeedToggle />
      </div>
      <AudioStatus word={w} />

      {unverified && (
        <p className="text-sm text-muted-foreground">
          <AiBadge /> {t("words.detail.notVerified")}
        </p>
      )}

      {(w.hanja || w.han_viet) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-lg">
          {w.hanja && (
            <>
              <dt className="text-muted-foreground">{t("words.fields.hanja")}</dt>
              <dd lang="ko">{w.hanja}</dd>
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

      {(w.examples.length > 0 || exampleOwner) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("words.detail.examples")}</h2>
          <ul className="flex flex-col gap-3">
            {w.examples.map((ex, i) => (
              <li key={ex.id} className="rounded-lg border p-3">
                <ExampleItem ex={ex} lang={w.lang} glossLang={glossLang} audioLabel={t("audio.playExample", { n: i + 1 })} owner={exampleOwner} />
              </li>
            ))}
          </ul>
          {exampleOwner && w.examples.length < WORD_EXAMPLES_MAX && <AddExampleButton owner={exampleOwner} />}
        </section>
      )}

      <PhrasesSection word={w} />

      <LinkButton to={`/practice/${w.id}`} variant="secondary">
        {t("pages.wordDetail.practice")}
      </LinkButton>
      {firstChar && (
        <LinkButton to={`/chars/${firstChar}`} variant="outline">
          {t("pages.wordDetail.character")}
        </LinkButton>
      )}
      {profile && canManageProfiles(profile) && <DeleteWordButton word={w} profileId={profile.id} />}
    </div>
    </FocusLayer>
  );
}
