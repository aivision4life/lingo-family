import { describe, expect, it } from "vitest";
import { isStaticFilePath } from "./staticPath";

// M7.4: what the Worker answers 404 for. The rule is the shape of the path, so a route added
// tomorrow needs no change here — which is the whole point, a list would be forgotten once.
describe("isStaticFilePath", () => {
  it("is true for the build's own files", () => {
    for (const p of [
      "/assets/index-DOKyX6mb.css",
      "/assets/index-8XlKg3n2.js",
      "/assets/index-8XlKg3n2.js.map",
      "/assets/noto-sans-kr-0-400-normal-CVyYOjaz.woff2",
      "/icons/icon-192.png",
      "/favicon.svg",
      "/manifest.webmanifest",
      "/sw.js",
      "/index.html",
    ]) {
      expect(isStaticFilePath(p), p).toBe(true);
    }
  });

  it("is false for every route of the app, including ones that do not exist yet", () => {
    for (const p of [
      "/",
      "/home",
      "/profiles",
      "/words",
      "/words/new",
      "/words/8f1c2a3e-0000-4000-8000-000000000001",
      "/albums/42",
      "/review",
      "/settings",
      "/topik",
      "/topik/manage",
      "/topik/tests",
      "/topik/tests/e3019569-f666-4a2a-8c4c-583729c7afc7",
      "/topik/tests/audio-probe",
      "/something/invented/later",
    ]) {
      expect(isStaticFilePath(p), p).toBe(false);
    }
  });

  // The known limit of the shape test, stated rather than hidden: anything ending in ".<letters or
  // digits>" counts as a file, so a route could not have a dot in its last segment. No route does,
  // and if one ever needs to, this is the single place that has to change.
  it("treats any dotted last segment as a file", () => {
    expect(isStaticFilePath("/words/level.5")).toBe(true);
  });
});
