import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PRON_DAILY_QUOTA_ADULT,
  PRON_DAILY_QUOTA_KID,
  PRON_ERRORS,
  PRON_FAMILY_DAILY_CAP,
  pronProbeResponseSchema,
} from "../../shared/pron";
import { profileSchema, type ProfileCreate } from "../../shared/profile";
import { encodeWav, PRON_MAX_SECONDS, PRON_SAMPLE_RATE } from "../../shared/wav";
import { fakePron } from "../test/fakePron";
import { createTestEnv, testApp } from "../test/testEnv";

const pron = fakePron();
let t: Awaited<ReturnType<typeof createTestEnv>>;
let none: Awaited<ReturnType<typeof createTestEnv>>;

beforeAll(async () => {
  t = await createTestEnv(testApp({ makePron: () => pron.client }));
  none = await createTestEnv(); // paid clients default to null: Azure "not configured"
}, 120_000);
afterAll(async () => {
  await t.dispose();
  await none.dispose();
});
beforeEach(async () => {
  await t.env.DB.prepare("DELETE FROM profiles").run();
  await t.env.DB.prepare("DELETE FROM usage_daily").run();
  pron.calls.length = 0;
  pron.state.fail = false;
});

const adult: ProfileCreate = {
  name: "Bố",
  avatar: "🐻",
  ui_lang: "vi",
  gloss_lang: "vi",
  is_kid: false,
  daily_new_limit: 15,
  study_langs: ["ko", "en"],
};

const create = async (env: typeof t, input: ProfileCreate) => {
  const res = await env.api("POST", "/profiles", input);
  expect(res.status).toBe(201);
  return profileSchema.parse(res.body);
};

const ONE_SECOND = encodeWav(new Int16Array(PRON_SAMPLE_RATE).fill(500));

const probe = (env: typeof t, profileId: string, body: BodyInit = ONE_SECOND, extra = "") =>
  env.send(`/api/pron/probe?profile_id=${profileId}&lang=ko&text=${encodeURIComponent("사과")}${extra}`, {
    method: "POST",
    headers: { "content-type": "audio/wav" },
    body,
  });

/** Puts `count` scoring attempts on today's meter for a profile, as if they had happened. */
const spend = (profileId: string, count: number) =>
  t.env.DB.prepare("INSERT INTO usage_daily (date, profile_id, service, count) VALUES (?1, ?2, 'pron', ?3)")
    .bind(new Date().toISOString().slice(0, 10), profileId, count)
    .run();

const used = async (profileId: string) => {
  const row = await t.env.DB.prepare("SELECT count FROM usage_daily WHERE profile_id = ?1 AND service = 'pron'")
    .bind(profileId)
    .first<{ count: number }>();
  return row?.count ?? 0;
};

describe("POST /api/pron/probe (M3.0)", () => {
  it("returns Azure's answer untouched and counts one quota unit", async () => {
    const p = await create(t, adult);
    const res = await probe(t, p.id, ONE_SECOND, "&miscue=1&alphabet=IPA");
    expect(res.status).toBe(200);
    const body = pronProbeResponseSchema.parse(await res.json());
    expect(body.raw).toEqual(pron.state.answer);
    expect(body.audio_ms).toBe(1000);
    expect(pron.calls).toEqual([{ bytes: ONE_SECOND.byteLength, lang: "ko", text: "사과", options: { miscue: true, alphabet: "IPA" } }]);
    expect(await used(p.id)).toBe(1);
  });

  it("refuses an unknown profile before anything is paid for", async () => {
    expect((await probe(t, "nope")).status).toBe(404);
    expect(pron.calls).toHaveLength(0);
  });

  it("lets a kid profile practise, on the smaller kid allowance", async () => {
    const grownUp = await create(t, adult); // a kid profile can only exist beside an adult
    const kid = await create(t, { ...adult, name: "Bé", is_kid: true });
    expect((await probe(t, kid.id)).status).toBe(200);
    expect(await used(kid.id)).toBe(1);

    // The same number of attempts stops the kid and not the adult.
    await t.env.DB.prepare("DELETE FROM usage_daily").run();
    await spend(kid.id, PRON_DAILY_QUOTA_KID);
    await spend(grownUp.id, PRON_DAILY_QUOTA_KID);
    expect((await probe(t, kid.id)).status).toBe(429);
    expect((await probe(t, grownUp.id)).status).toBe(200);
  });

  it("stops everyone at the family cap, even a profile that has used nothing itself", async () => {
    const people = [];
    for (const name of ["A", "B", "C", "D"]) people.push(await create(t, { ...adult, name }));
    const [a, b, c, d] = people as [(typeof people)[0], (typeof people)[0], (typeof people)[0], (typeof people)[0]];
    await spend(a.id, PRON_DAILY_QUOTA_ADULT);
    await spend(b.id, PRON_DAILY_QUOTA_ADULT);
    await spend(c.id, PRON_FAMILY_DAILY_CAP - 2 * PRON_DAILY_QUOTA_ADULT - 1); // one unit left for the family

    expect((await probe(t, d.id)).status).toBe(200); // takes the last one
    const res = await probe(t, d.id);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: PRON_ERRORS.quotaExceeded });
    expect(await used(d.id)).toBe(1);
    expect(pron.calls).toHaveLength(1);
  });

  it("refuses a take longer than our own limit, well inside what Azure would accept", async () => {
    const p = await create(t, adult);
    const tooLong = encodeWav(new Int16Array((PRON_MAX_SECONDS + 1) * PRON_SAMPLE_RATE));
    expect((await probe(t, p.id, tooLong)).status).toBe(400);
    expect((await probe(t, p.id, encodeWav(new Int16Array(PRON_MAX_SECONDS * PRON_SAMPLE_RATE)))).status).toBe(200);
    expect(await used(p.id)).toBe(1);
  });

  it("refuses audio that is not a 16 kHz mono WAV, at no cost", async () => {
    const p = await create(t, adult);
    const wrongRate = await probe(t, p.id, encodeWav(new Int16Array(48_000), 48_000));
    expect(wrongRate.status).toBe(400);
    expect(await wrongRate.json()).toMatchObject({ error: PRON_ERRORS.invalidAudio });
    expect((await probe(t, p.id, "not audio at all, just some text that is long enough")).status).toBe(400);
    expect(pron.calls).toHaveLength(0);
    expect(await used(p.id)).toBe(0);
  });

  it("gives the quota unit back when Azure fails", async () => {
    const p = await create(t, adult);
    pron.state.fail = true;
    const res = await probe(t, p.id);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: PRON_ERRORS.failed });
    expect(await used(p.id)).toBe(0);
  });

  it("stops at the daily quota without calling Azure", async () => {
    const p = await create(t, adult);
    await spend(p.id, PRON_DAILY_QUOTA_ADULT);
    const res = await probe(t, p.id);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: PRON_ERRORS.quotaExceeded });
    expect(pron.calls).toHaveLength(0);
    expect(await used(p.id)).toBe(PRON_DAILY_QUOTA_ADULT);
  });

  it("answers 503 when Azure Speech is not configured, at no cost", async () => {
    const p = await create(none, adult);
    const res = await probe(none, p.id);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: PRON_ERRORS.unavailable });
  });
});
