import { describe, expect, it } from "vitest";
import type { TopikTestSitting } from "@shared/topik";
import { CHART_BOX, CHART_PAD, scoreChart } from "./scoreChart";

const DAY = 86_400_000;

const sitting = (over: Partial<TopikTestSitting> = {}): TopikTestSitting => ({
  id: "t1",
  section: "listening",
  kind: "original",
  source_exam: "Test-35회",
  from_number: 1,
  to_number: 20,
  question_count: 20,
  correct_count: 10,
  score_points: 20,
  total_points: 40,
  finished_at: 0,
  ...over,
});

const bottom = CHART_BOX.height - CHART_PAD.bottom;
const left = CHART_PAD.left;
const right = CHART_BOX.width - CHART_PAD.right;

describe("scoreChart", () => {
  it("has no series at all for an empty history", () => {
    expect(scoreChart([])).toMatchObject({ series: [], from: 0, to: 0 });
  });

  it("puts a single sitting in the middle of the box, at its own percent", () => {
    const { series } = scoreChart([sitting({ score_points: 20, total_points: 40 })]);
    expect(series).toHaveLength(1);
    expect(series[0]!.dots[0]).toMatchObject({ id: "t1", percent: 50, x: (left + right) / 2 });
    expect(series[0]!.dots[0]!.y).toBeCloseTo((CHART_PAD.top + bottom) / 2, 1);
  });

  it("spreads the x axis over real time, oldest at the left edge and newest at the right", () => {
    const { series, from, to } = scoreChart([
      sitting({ id: "c", finished_at: 10 * DAY }),
      sitting({ id: "a", finished_at: 0 }),
      sitting({ id: "b", finished_at: 5 * DAY }),
    ]);
    expect([from, to]).toEqual([0, 10 * DAY]);
    expect(series[0]!.dots.map((d) => [d.id, d.x])).toEqual([
      ["a", left],
      ["b", (left + right) / 2],
      ["c", right],
    ]);
  });

  it("gives 0% the bottom of the box and 100% the top", () => {
    const { series } = scoreChart([
      sitting({ id: "zero", score_points: 0, total_points: 40, finished_at: 0 }),
      sitting({ id: "full", score_points: 40, total_points: 40, finished_at: DAY }),
    ]);
    expect(series[0]!.dots.map((d) => [d.percent, d.y])).toEqual([
      [0, bottom],
      [100, CHART_PAD.top],
    ]);
  });

  it("keeps original papers and mixed ones as two separate lines", () => {
    const { series } = scoreChart([
      sitting({ id: "o", kind: "original", finished_at: 0 }),
      sitting({ id: "m", kind: "mixed", source_exam: null, finished_at: DAY }),
    ]);
    expect(series.map((s) => [s.kind, s.dots.map((d) => d.id)])).toEqual([
      ["original", ["o"]],
      ["mixed", ["m"]],
    ]);
  });

  it("writes the polyline oldest to newest, whatever order the sittings arrive in", () => {
    const { series } = scoreChart([
      sitting({ id: "late", score_points: 40, total_points: 40, finished_at: DAY }),
      sitting({ id: "early", score_points: 0, total_points: 40, finished_at: 0 }),
    ]);
    expect(series[0]!.polyline).toBe(`${left},${bottom} ${right},${CHART_PAD.top}`);
  });

  it("treats a sitting worth no points as 0% instead of dividing by zero", () => {
    const { series } = scoreChart([sitting({ score_points: 0, total_points: 0 })]);
    expect(series[0]!.dots[0]).toMatchObject({ percent: 0, y: bottom });
  });
});
