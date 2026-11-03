// M7.4: what the Worker answers for a path that matched no static asset. A missing file must be a
// real 404 — the previous setting answered index.html, which is how a service worker ended up
// storing an HTML page as a stylesheet, failing to install, and leaving a phone on the old build.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv } from "../test/testEnv";

let t: Awaited<ReturnType<typeof createTestEnv>>;

beforeAll(async () => {
  t = await createTestEnv();
}, 60_000);
afterAll(() => t.dispose());

/** The test environment has no assets binding, which is also what local dev looks like. */
const get = (path: string) => t.raw(`http://localhost${path}`);

describe("paths that match no asset", () => {
  it("answers a real 404 for a missing build file, never HTML", async () => {
    for (const path of ["/assets/index-DOKyX6mb.css", "/assets/index-8XlKg3n2.js", "/icons/icon-192.png"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("content-type"), path).toContain("text/plain");
      expect(await res.text(), path).not.toContain("<!doctype html");
    }
  });

  it("keeps the API's own 404 as JSON", async () => {
    const res = await get("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("treats an app route as a page, not as a file", async () => {
    // With no assets binding there is no index.html to hand back, so the interesting part is that
    // it is NOT refused as a file: the status is the same 404, but by a different path through the
    // code. The shape rule itself is covered by shared/staticPath.test.ts.
    const res = await get("/topik/tests/e3019569-f666-4a2a-8c4c-583729c7afc7");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});
