import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guards for the crash in M7.22 — and an honest account of what a guard can be here.
 *
 * What happened: `useMarkSource` threw during render when no `MarkSourceContext` was above it, and
 * the listening transcript is drawn outside the question cards, which are the only things that
 * provide one. So tapping a word in a transcript did not fail to offer a button — it took the
 * whole practice screen down with "Unexpected Application Error!".
 *
 * **This project has no component tests**, so nothing here renders React. A test that could have
 * caught the original bug would have had to mount `TopikSession` with a listening pair, answer
 * both questions, open the transcript and click a word — six steps of real rendering. These are
 * not that. They are two cheap checks over the source text, and they are worth having only
 * because of what they pin:
 *
 * 1. **The hook never throws.** This is the property that turns the bug from a white screen into
 *    a missing button. It is the difference between "a feature is unavailable here" and "the
 *    session is over". Pinned by reading the file, because a hook cannot be called outside a
 *    renderer — crude, but it fails the moment someone reinstates the throw.
 * 2. **The list of places that draw tappable text is fixed.** Every entry has to say where its
 *    source comes from. Adding a new one makes this test fail, which is a prompt to answer the
 *    question — the shared passage added in the same afternoon as this fix opened the very same
 *    hole again, and this list is what would have asked about it.
 *
 * What they do NOT check: that the provider is actually in the tree at runtime, that its value is
 * the right question, or that the button appears. Only a rendered screen shows that, and the
 * browser is still where that gets verified.
 */
const read = (path: string) => readFileSync(`src/features/topik/${path}`, "utf8");

describe("useMarkSource never throws (M7.22)", () => {
  it("returns the context as it is, null included", () => {
    const source = read("markSource.ts");
    expect(source).toContain("export function useMarkSource(): TopikWordSource | null");
    expect(source).not.toMatch(/throw new Error/);
  });

  it("is the toggle that decides there is nothing to offer, by rendering nothing", () => {
    // Where the invariant lives now: no source, no button, so `toggle()` cannot be reached
    // without one. The old throw defended the same rule from inside the render pass.
    const toggle = read("TopikMarkToggle.tsx");
    expect(toggle).toContain("if (!source) return null;");
  });
});

describe("every place that draws tappable text has a known source (M7.22)", () => {
  /**
   * File -> where a word tapped in it is filed. Keep it answerable in one line; if a new site
   * cannot be explained in one, that is the signal, not the inconvenience.
   */
  const SITES: Record<string, string> = {
    "TopikQuestionCard.tsx": "provides its own MarkSourceContext for the question it draws",
    "TopikSession.tsx": "provides `groupSource` around the shared passage and the transcript",
    "TopikTestResultView.tsx": "provides the sitting item's source, or none when the question was deleted",
    "TopikTranscript.tsx": "drawn by TopikSession inside `groupSource`",
    "TopikWordPopover.tsx": "the popover itself; its toggle reads whatever source it is rendered under",
    "TopikExplanation.tsx": "drawn by TopikQuestionCard, inside that card's source",
  };

  // Mirrors `grep -rn "<TopikWordTap\|<TappableText\|<TopikMarkToggle" src/`.
  const RENDERS = /<(TopikWordTap|TappableText|TopikMarkToggle)[\s/>]/;

  it("lists exactly the files that render one", () => {
    const found = Object.keys(SITES).filter((f) => RENDERS.test(read(f)));
    expect(found.sort()).toEqual(Object.keys(SITES).sort());
  });

  it("the two screens that draw text outside a question card provide a source themselves", () => {
    // The hole this closes, twice over: the transcript (the production crash) and the shared
    // passage (added hours later, same shape).
    const session = read("TopikSession.tsx");
    expect(session).toContain("MarkSourceContext.Provider value={groupSource}");
    expect(session.match(/MarkSourceContext\.Provider value=\{groupSource\}/g)).toHaveLength(2);
    expect(read("TopikTestResultView.tsx")).toContain("MarkSourceContext.Provider");
  });
});
