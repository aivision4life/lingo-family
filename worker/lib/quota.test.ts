import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { UsageService } from "../../shared/enums";
import { profileSchema, type ProfileCreate } from "../../shared/profile";
import { createTestEnv } from "../test/testEnv";
import { consumeTieredQuota, refundQuota, usageDate } from "./quota";

let t: Awaited<ReturnType<typeof createTestEnv>>;

beforeAll(async () => {
  t = await createTestEnv();
}, 60_000);
afterAll(() => t.dispose());
beforeEach(async () => {
  await t.env.DB.prepare("DELETE FROM profiles").run();
  await t.env.DB.prepare("DELETE FROM usage_daily").run();
});

const NOW = new Date("2026-11-13T03:00:00Z");
const base: ProfileCreate = { name: "A", avatar: "🐻", ui_lang: "vi", gloss_lang: "vi", is_kid: false, daily_new_limit: 15, study_langs: ["ko"] };

const person = async (name: string) => {
  const res = await t.api("POST", "/profiles", { ...base, name });
  expect(res.status).toBe(201);
  return profileSchema.parse(res.body).id;
};

/** Puts `count` uses on today's meter, as if they had already happened. */
const spend = (profileId: string, service: UsageService, count: number) =>
  t.env.DB.prepare("INSERT INTO usage_daily (date, profile_id, service, count) VALUES (?1, ?2, ?3, ?4)")
    .bind(usageDate(NOW), profileId, service, count)
    .run();

const used = async (profileId: string, service: UsageService) => {
  const row = await t.env.DB.prepare("SELECT count FROM usage_daily WHERE date = ?1 AND profile_id = ?2 AND service = ?3")
    .bind(usageDate(NOW), profileId, service)
    .first<{ count: number }>();
  return row?.count ?? 0;
};

const consume = (profileId: string, service: UsageService, perProfile: number, familyCap: number) =>
  consumeTieredQuota(t.env.DB, profileId, service, perProfile, familyCap, NOW);

const BURST = 20;
const wins = (results: boolean[]) => results.filter(Boolean).length;

describe("consumeTieredQuota", () => {
  // What these two cases can and cannot show is written above `consumeTieredQuota` itself.
  it("a burst of calls issued together takes the profile's last unit exactly once", async () => {
    const me = await person("A");
    await spend(me, "pron", 24);
    const results = await Promise.all(Array.from({ length: BURST }, () => consume(me, "pron", 25, 1000)));
    expect(wins(results)).toBe(1);
    expect(await used(me, "pron")).toBe(25);
  });

  it("a burst of calls from different profiles takes the family's last unit exactly once", async () => {
    const people = [];
    for (let i = 0; i < BURST; i++) people.push(await person(`P${i}`));
    const spender = await person("spender");
    await spend(spender, "pron", 59);
    const results = await Promise.all(people.map((id) => consume(id, "pron", 25, 60)));
    expect(wins(results)).toBe(1);
    const total = await t.env.DB.prepare("SELECT sum(count) AS n FROM usage_daily WHERE service = 'pron'").first<{ n: number }>();
    expect(total?.n).toBe(60);
  });

  it("stops at the profile limit and at the family cap, counting nothing once either is reached", async () => {
    const me = await person("A");
    const other = await person("B");
    expect(await consume(me, "pron", 2, 3)).toBe(true);
    expect(await consume(me, "pron", 2, 3)).toBe(true);
    expect(await consume(me, "pron", 2, 3)).toBe(false); // own limit
    expect(await consume(other, "pron", 2, 3)).toBe(true);
    expect(await consume(other, "pron", 2, 3)).toBe(false); // family cap, with one of its own left
    expect([await used(me, "pron"), await used(other, "pron")]).toEqual([2, 1]);
  });

  it("services do not share a family cap: pronunciation takes nothing from images, nor images from pronunciation", async () => {
    const me = await person("A");
    const other = await person("B");

    await spend(other, "pron", 60); // pronunciation is at its family cap…
    expect(await consume(me, "pron", 25, 60)).toBe(false);
    expect(await consume(me, "image", 60, 60)).toBe(true); // …and an image cap of the same size is untouched

    await t.env.DB.prepare("DELETE FROM usage_daily").run();
    await spend(other, "image", 100); // and the other way round
    expect(await consume(me, "image", 60, 100)).toBe(false);
    expect(await consume(me, "pron", 25, 60)).toBe(true);
    expect([await used(me, "image"), await used(me, "pron")]).toEqual([0, 1]);
  });
});

describe("refundQuota", () => {
  it("gives back one unit of the named service and leaves every other row alone", async () => {
    const me = await person("A");
    const other = await person("B");
    await spend(me, "pron", 3);
    await spend(me, "image", 5);
    await spend(other, "pron", 7);

    await refundQuota(t.env.DB, me, "pron", NOW);
    expect([await used(me, "pron"), await used(me, "image"), await used(other, "pron")]).toEqual([2, 5, 7]);
  });

  it("never goes below zero, and does nothing when there is no row", async () => {
    const me = await person("A");
    await spend(me, "pron", 1);
    await refundQuota(t.env.DB, me, "pron", NOW);
    await refundQuota(t.env.DB, me, "pron", NOW);
    await refundQuota(t.env.DB, me, "image", NOW);
    expect([await used(me, "pron"), await used(me, "image")]).toEqual([0, 0]);
  });
});
