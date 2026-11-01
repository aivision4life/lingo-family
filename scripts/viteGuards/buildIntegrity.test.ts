import { describe, expect, it } from "vitest";
import {
  bundleSizeProblem,
  CLIENT_MODULE_CEILING,
  duplicateModulesMessage,
  findDuplicateModules,
  moduleCountProblem,
} from "./buildIntegrity";

describe("findDuplicateModules", () => {
  it("finds nothing in a sane graph", () => {
    expect(findDuplicateModules(["D:/DEV/app/src/main.tsx", "D:/DEV/app/src/i18n/index.ts"])).toEqual([]);
  });

  it("finds the real M7.2 case: one file under two path casings", () => {
    const groups = findDuplicateModules([
      "D:/DEV/lingo-family/node_modules/react/index.js",
      "D:/dev/lingo-family/node_modules/react/index.js",
      "D:/DEV/lingo-family/src/main.tsx",
    ]);
    expect(groups).toEqual([
      ["D:/DEV/lingo-family/node_modules/react/index.js", "D:/dev/lingo-family/node_modules/react/index.js"],
    ]);
  });

  it("groups three or more spellings of the same file together", () => {
    const groups = findDuplicateModules(["D:/A/x.ts", "D:/a/x.ts", "d:/a/X.ts"]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it("keeps genuinely different files apart", () => {
    expect(findDuplicateModules(["D:/a/x.ts", "D:/a/y.ts"])).toEqual([]);
  });
});

describe("duplicateModulesMessage", () => {
  it("names both spellings and points at the working directory", () => {
    const msg = duplicateModulesMessage([["D:/DEV/app/node_modules/react/index.js", "D:/dev/app/node_modules/react/index.js"]]);
    expect(msg).toContain("D:/DEV/app/node_modules/react/index.js");
    expect(msg).toContain("D:/dev/app/node_modules/react/index.js");
    expect(msg).toContain("differently-cased path");
  });

  it("caps the list instead of printing thousands of lines", () => {
    const groups = Array.from({ length: 2040 }, (_, i) => [`D:/A/f${i}.ts`, `D:/a/f${i}.ts`]);
    const msg = duplicateModulesMessage(groups);
    expect(msg).toContain("2040 file(s)");
    expect(msg).toContain("and 2030 more");
    expect(msg.split("\n").length).toBeLessThan(40);
  });
});

describe("moduleCountProblem", () => {
  it("accepts the healthy client graph", () => {
    expect(moduleCountProblem(2438)).toBeNull();
    expect(moduleCountProblem(CLIENT_MODULE_CEILING)).toBeNull();
  });

  it("rejects the duplicated graph", () => {
    expect(moduleCountProblem(4478)).toContain("4478 modules");
  });

  it("explains that the ceiling may be raised on purpose when the app grows", () => {
    expect(moduleCountProblem(CLIENT_MODULE_CEILING + 1)).toContain("raised on purpose");
  });
});

describe("bundleSizeProblem", () => {
  it("accepts the healthy bundle (~890 KB)", () => {
    expect(bundleSizeProblem(886_823)).toBeNull();
  });

  it("rejects the duplicated bundle (~1.05 MB)", () => {
    expect(bundleSizeProblem(1_053_544)).toContain("KB ceiling");
  });
});
