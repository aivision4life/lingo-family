import { describe, expect, it } from "vitest";
import { chunkForD1, D1_MAX_PARAMS, readInD1Chunks, writeInD1Chunks } from "./d1Chunk";

const rows = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("chunkForD1", () => {
  it("keeps a whole batch in one statement when it fits", () => {
    // 12 x 7 = 84 parameters: the mock test size that worked before the papers grew.
    expect(chunkForD1(rows(12), 7)).toEqual([rows(12)]);
  });

  it("splits at the ceiling, not after it", () => {
    // 20 x 7 = 140, which is the size that returned 500 on every attempt.
    const chunks = chunkForD1(rows(20), 7);
    expect(chunks.map((c) => c.length)).toEqual([14, 6]);
    expect(chunks.every((c) => c.length * 7 <= D1_MAX_PARAMS)).toBe(true);
  });

  it("keeps a full 50-question paper under the ceiling in every chunk", () => {
    const chunks = chunkForD1(rows(50), 7);
    expect(chunks.flat()).toEqual(rows(50));
    expect(Math.max(...chunks.map((c) => c.length * 7))).toBeLessThanOrEqual(D1_MAX_PARAMS);
  });

  it("is exact at the boundary", () => {
    expect(chunkForD1(rows(100), 1)).toEqual([rows(100)]);
    expect(chunkForD1(rows(101), 1).map((c) => c.length)).toEqual([100, 1]);
  });

  it("leaves room for parameters the statement binds outside the rows", () => {
    // e.g. `WHERE deck_id = ? AND word_id IN (...)`.
    expect(chunkForD1(rows(100), 1, { reserved: 1 }).map((c) => c.length)).toEqual([99, 1]);
  });

  it("has nothing to do for no rows", () => {
    expect(chunkForD1([], 7)).toEqual([]);
  });

  it("still emits a row that cannot fit alone, rather than dropping it", () => {
    // D1 will reject it, loudly — which beats a statement that silently wrote less than it was given.
    expect(chunkForD1(rows(2), 200)).toEqual([[1], [2]]);
  });
});

describe("writeInD1Chunks", () => {
  it("writes every row, in order, one statement per chunk", async () => {
    const written: number[][] = [];
    await writeInD1Chunks(rows(20), 7, async (chunk) => void written.push(chunk));
    expect(written.map((c) => c.length)).toEqual([14, 6]);
    expect(written.flat()).toEqual(rows(20));
  });

  it("does nothing at all for no rows", async () => {
    const written: number[][] = [];
    await writeInD1Chunks([], 7, async (chunk) => void written.push(chunk));
    expect(written).toEqual([]);
  });
});

describe("readInD1Chunks", () => {
  it("concatenates the results of each chunk, in the order the ids were given", async () => {
    const seen: number[][] = [];
    const out = await readInD1Chunks(rows(250), async (chunk) => {
      seen.push(chunk);
      return chunk.map((n) => `w${n}`);
    });
    expect(seen.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(out).toHaveLength(250);
    expect(out[0]).toBe("w1");
    expect(out.at(-1)).toBe("w250");
  });

  it("does not run the query at all for no ids", async () => {
    let calls = 0;
    const out = await readInD1Chunks([], async () => {
      calls += 1;
      return [];
    });
    expect([calls, out]).toEqual([0, []]);
  });
});
