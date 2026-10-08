// Renders benchmarks/report.html: rows = items, columns = models.

export type Cell = {
  status: "ok" | "skipped" | "error";
  file?: string;
  ms?: number;
  bytes?: number;
  width?: number;
  height?: number;
  neurons?: number;
  full_prompt?: string;
  error?: string;
};

export type BenchResults = {
  generated_at: string;
  /** Primary LLM model (LLM_MODEL). */
  llm_model: string;
  /** LLM_FALLBACK_MODEL, used when the primary was busy. */
  llm_fallback_model?: string | null;
  style: string;
  style_version: string;
  size: number;
  /** null = no seed sent (flux-1-schnell does not accept one). */
  seed: number | null;
  models: { label: string; id: string; pricing: string }[];
  items: {
    id: string; kind: string; lang: string; level: string; text: string; note: string;
    image_prompt: string; full_prompt: string;
    /** Model that wrote image_prompt (LLM_FALLBACK_MODEL when the primary was busy). */
    prompt_model?: string;
    prompt_error?: string;
  }[];
  cells: Record<string, Record<string, Cell>>;
};

export const DASHBOARD_GUIDE = [
  "How to see the real Neurons used:",
  "  1. Open https://dash.cloudflare.com and pick your account.",
  "  2. Left menu: AI > Workers AI (on some dashboards: Compute (Workers) > Workers AI).",
  "  3. Open the usage / analytics view: Neurons per day and per model.",
  "     Pick the time range covering the benchmark run (data can lag a few minutes).",
  "  4. Divide each model's Neurons by the number of images it drew in that run",
  "     (see benchmarks/report.html) and compare with the estimate in the report.",
  "  Free allocation: 10,000 Neurons per day (resets at 00:00 UTC).",
].join("\n");

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

function cellHtml(c: Cell | undefined, alt: string) {
  if (!c) return `<td class="muted">—</td>`;
  if (c.status !== "ok") return `<td><p class="${c.status}">${c.status}</p><p class="muted small">${esc(c.error ?? "")}</p></td>`;
  return `<td>
    <a href="${esc(c.file!)}"><img src="${esc(c.file!)}" alt="${esc(alt)}" loading="lazy"></a>
    <p class="small">${((c.ms ?? 0) / 1000).toFixed(1)} s · ${kb(c.bytes ?? 0)} · ${c.width}×${c.height} · ≈ ${c.neurons} Neurons</p>
  </td>`;
}

function summaryRows(r: BenchResults) {
  return r.models
    .map((m) => {
      const ok = r.items.map((i) => r.cells[i.id]?.[m.label]).filter((c): c is Cell => c?.status === "ok");
      if (!ok.length) return `<tr><th>${esc(m.label)}</th><td colspan="4" class="muted">no images</td></tr>`;
      const avg = (f: (c: Cell) => number) => ok.reduce((s, c) => s + f(c), 0) / ok.length;
      const neurons = avg((c) => c.neurons ?? 0);
      return `<tr><th>${esc(m.label)}</th><td>${(avg((c) => c.ms ?? 0) / 1000).toFixed(1)} s</td><td>${kb(avg((c) => c.bytes ?? 0))}</td>
        <td>≈ ${neurons.toFixed(1)}</td><td>≈ ${Math.floor(10000 / neurons)}</td></tr>`;
    })
    .join("\n");
}

const isFallback = (r: BenchResults, model?: string) => !!model && model !== r.llm_model;

function promptBy(r: BenchResults, model?: string) {
  if (!model) return "";
  if (!isFallback(r, model)) return `<p class="muted small">prompt by ${esc(model)}</p>`;
  return `<p class="small"><span class="badge">fallback model</span> prompt by ${esc(model)} (${esc(r.llm_model)} was busy)</p>`;
}

function promptSummary(r: BenchResults) {
  const fallback = r.items.filter((i) => isFallback(r, i.prompt_model)).length;
  const primary = r.items.filter((i) => i.prompt_model === r.llm_model).length;
  const parts = [`<strong>image_prompt:</strong> ${primary} by ${esc(r.llm_model)} (primary)`];
  if (fallback) parts.push(`<span class="badge">${fallback} by the fallback model ${esc(r.llm_fallback_model ?? "")}</span>`);
  return parts.join(" · ");
}

export function renderReport(r: BenchResults) {
  const header = r.models.map((m) => `<th>${esc(m.label)}<br><span class="muted small">${esc(m.pricing)}</span></th>`).join("");
  const rows = r.items
    .map((i) => {
      const cells = r.models.map((m) => cellHtml(r.cells[i.id]?.[m.label], i.image_prompt)).join("");
      return `<tr><th class="item"><p lang="${esc(i.lang)}" class="term">${esc(i.text)}</p>
        <p class="muted small">${esc(i.kind)} · ${esc(i.note)} · ${esc(i.level)}</p>
        ${i.image_prompt ? `<p class="prompt">${esc(i.image_prompt)}</p>` : `<p class="error small">${esc(i.prompt_error ?? "no prompt")}</p>`}
        ${promptBy(r, i.prompt_model)}</th>${cells}</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Image benchmark</title>
<style>
  :root { --bg: #fff; --fg: #1a1a1a; --muted: #6b6b6b; --line: #ddd; --bad: #b42318; --warn: #b54708; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161616; --fg: #eee; --muted: #a0a0a0; --line: #333; --bad: #f97066; --warn: #fdb022; } }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, sans-serif; }
  .wrap { overflow-x: auto; } table { border-collapse: collapse; } th, td { border: 1px solid var(--line); padding: 8px; vertical-align: top; text-align: left; }
  img { width: 256px; height: auto; display: block; border-radius: 6px; }
  .item { width: 240px; font-weight: normal; } .term { font-size: 22px; font-weight: 600; margin: 0; }
  [lang="ko"] { font-family: "Noto Sans KR", system-ui, sans-serif; }
  .prompt { font-style: italic; } .muted { color: var(--muted); } .small { font-size: 12px; margin: 4px 0 0; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 4px; background: var(--warn); color: var(--bg); font-weight: 600; }
  .error { color: var(--bad); font-weight: 600; } .skipped { color: var(--warn); font-weight: 600; }
  pre { white-space: pre-wrap; background: color-mix(in srgb, var(--fg) 6%, transparent); padding: 12px; border-radius: 6px; }
</style></head><body>
<h1>Image benchmark (M1.8A)</h1>
<p class="muted">${esc(r.generated_at)} · requested size ${r.size}×${r.size} (flux-1-schnell has no size parameter) · ${r.seed === null ? "no seed" : `seed ${r.seed}`} · ${esc(r.style_version)}</p>
<p>${promptSummary(r)}</p>
<p><strong>Style appended to every prompt:</strong> ${esc(r.style)}</p>
<h2>Summary (estimates from the price list)</h2>
<div class="wrap"><table><tr><th>Model</th><th>Avg time</th><th>Avg size</th><th>Neurons / image</th><th>Images / day (10,000 free)</th></tr>
${summaryRows(r)}</table></div>
<h2>Images</h2>
<div class="wrap"><table><tr><th>Item · image_prompt</th>${header}</tr>
${rows}</table></div>
<h2>Real Neurons</h2>
<pre>${esc(DASHBOARD_GUIDE)}</pre>
</body></html>
`;
}
