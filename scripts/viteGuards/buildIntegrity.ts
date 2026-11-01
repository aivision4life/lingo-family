/**
 * Build-time guard against a bundle that contains every module twice (M7.2).
 *
 * Windows opens files case-insensitively, but Vite keys modules by their id *string*. When the build
 * runs from a working directory whose casing differs from the real one on disk (`d:\dev\lingo-family`
 * instead of `D:\DEV\lingo-family`), `root` keeps the typed casing while the resolver's realpath
 * returns the real one — so the same file enters the graph under two ids. Everything reachable from
 * both is duplicated, including `node_modules/react/index.js`, and one copy's React is read before
 * it is initialized: `Cannot read properties of null (reading 'useSyncExternalStore')`, a white
 * screen that only ever appeared on production because local builds happened to use the right
 * casing. `root` in vite.config.ts is pinned to the real path, which fixes the cause; this guard is
 * the net, because the failure mode is silent (build succeeds, tests pass, the local preview works).
 */
import type { Plugin } from "vite";

/** Groups of ids that point at one file through different spellings; empty when the graph is sane. */
export function findDuplicateModules(ids: Iterable<string>): string[][] {
  const byKey = new Map<string, string[]>();
  for (const id of ids) {
    const key = id.toLowerCase();
    byKey.set(key, [...(byKey.get(key) ?? []), id]);
  }
  return [...byKey.values()].filter((group) => group.length > 1);
}

export function duplicateModulesMessage(groups: string[][]): string {
  const shown = groups.slice(0, 10).map((g) => `  ${g.join("\n  <=> ")}`);
  const rest = groups.length > shown.length ? `\n  … and ${groups.length - shown.length} more` : "";
  return (
    `${groups.length} file(s) entered the bundle under more than one id, so their module (and everything ` +
    `reachable from them, React included) exists twice:\n${shown.join("\n")}${rest}\n` +
    `On Windows this usually means the build ran from a differently-cased path — check that the shell's ` +
    `working directory matches the real one on disk.`
  );
}

/**
 * Upper bound for the client graph. The healthy build is ~2438 modules; the duplicated one was 4478.
 * Raise this deliberately when the app itself grows — never to make a failing build pass.
 */
export const CLIENT_MODULE_CEILING = 3200;
/** Loose net for other kinds of bloat; the healthy bundle is ~890 KB, the duplicated one ~1.05 MB. */
export const CLIENT_BYTES_CEILING = 1_000_000;

export function moduleCountProblem(count: number, ceiling = CLIENT_MODULE_CEILING): string | null {
  if (count <= ceiling) return null;
  return (
    `the client graph has ${count} modules, over the ${ceiling} ceiling. Close to double means every ` +
    `module was loaded twice (see findDuplicateModules); a smaller overshoot means the app grew and ` +
    `CLIENT_MODULE_CEILING should be raised on purpose.`
  );
}

export function bundleSizeProblem(bytes: number, ceiling = CLIENT_BYTES_CEILING): string | null {
  if (bytes <= ceiling) return null;
  return `the client bundle is ${Math.round(bytes / 1024)} KB, over the ${Math.round(ceiling / 1024)} KB ceiling.`;
}

/**
 * Fails the build when the module graph is duplicated or has grown past its ceilings. Counts only
 * the app's own client build: the service worker is built as a second, much smaller `client`
 * environment, so it is identified by its own entry rather than by the environment name.
 */
export function buildIntegrity(): Plugin {
  const ids = new Map<string, Set<string>>();
  const idsFor = (env: string) => {
    const set = ids.get(env) ?? new Set<string>();
    ids.set(env, set);
    return set;
  };

  return {
    name: "build-integrity",
    enforce: "post",
    apply: "build",
    buildStart() {
      ids.set(this.environment?.name ?? "default", new Set());
    },
    moduleParsed(info) {
      idsFor(this.environment?.name ?? "default").add(info.id);
    },
    buildEnd(error) {
      if (error) return;
      const env = this.environment?.name ?? "default";
      const seen = [...idsFor(env)];
      const duplicates = findDuplicateModules(seen);
      if (duplicates.length > 0) this.error(duplicateModulesMessage(duplicates));
      // The service worker's own build is a handful of modules; only the app's graph has a ceiling.
      if (seen.some((id) => id.endsWith("/src/main.tsx"))) {
        console.log(`build-integrity: ${seen.length} client modules, no duplicates`);
        const problem = moduleCountProblem(seen.length);
        if (problem) this.error(`build-integrity: ${problem}`);
      }
    },
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== "chunk" || !output.isEntry || !fileName.endsWith(".js")) continue;
        if (!Object.keys(output.modules).some((id) => id.endsWith("/src/main.tsx"))) continue;
        const problem = bundleSizeProblem(Buffer.byteLength(output.code));
        if (problem) this.error(`build-integrity: ${problem}`);
      }
    },
  };
}
