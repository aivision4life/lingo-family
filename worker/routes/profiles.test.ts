import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { profileListSchema, profileSchema, type ProfileCreate } from "../../shared/profile";
import { createTestEnv } from "../test/testEnv";

let t: Awaited<ReturnType<typeof createTestEnv>>;

beforeAll(async () => {
  t = await createTestEnv();
}, 60_000);
afterAll(() => t.dispose());
beforeEach(async () => {
  await t.env.DB.prepare("DELETE FROM profiles").run();
});

const adult: ProfileCreate = {
  name: "Bố",
  avatar: "🐻",
  ui_lang: "vi",
  gloss_lang: "vi",
  is_kid: false,
  daily_new_limit: 15,
  study_langs: ["ko", "zh"],
};
const kid: ProfileCreate = { ...adult, name: "Bé", avatar: "🐰", is_kid: true, gloss_lang: "ko" };

const create = async (input: ProfileCreate) => {
  const res = await t.api("POST", "/profiles", input);
  expect(res.status).toBe(201);
  return profileSchema.parse(res.body);
};

describe("profiles API", () => {
  it("creates and lists profiles without leaking the PIN hash", async () => {
    const p = await create({ ...adult, pin: "1234" });
    expect(p).toMatchObject({ name: "Bố", has_pin: true, study_langs: ["ko", "zh"] });

    const list = await t.api("GET", "/profiles");
    expect(list.status).toBe(200);
    expect(profileListSchema.parse(list.body)).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain("pin_hash");
    expect(JSON.stringify(list.body)).not.toContain("pbkdf2");
  });

  it("rejects invalid input with 400 and issue paths", async () => {
    const res = await t.api("POST", "/profiles", { ...adult, name: " ", pin: "12a4", study_langs: [] });
    expect(res.status).toBe(400);
    const paths = (res.body as { issues: { path: string }[] }).issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["name", "pin", "study_langs"]));
  });

  it("rejects a PIN on a kid profile", async () => {
    await create(adult);
    const res = await t.api("POST", "/profiles", { ...kid, pin: "1234" });
    expect(res.status).toBe(400);
  });

  it("does not allow a kid as the first profile", async () => {
    const res = await t.api("POST", "/profiles", kid);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "last_adult" });
  });

  it("updates fields partially and sets/removes the PIN", async () => {
    const p = await create(adult);
    const withPin = await t.api("PATCH", `/profiles/${p.id}`, { ui_lang: "ko", pin: "4321" });
    expect(withPin.status).toBe(200);
    expect(withPin.body).toMatchObject({ ui_lang: "ko", has_pin: true, name: "Bố" });

    const noPin = await t.api("PATCH", `/profiles/${p.id}`, { pin: null });
    expect(noPin.body).toMatchObject({ has_pin: false, ui_lang: "ko" });
  });

  it("clears the PIN when a profile becomes a kid", async () => {
    await create(adult);
    const second = await create({ ...adult, name: "Mẹ", pin: "1111" });
    const res = await t.api("PATCH", `/profiles/${second.id}`, { is_kid: true });
    expect(res.body).toMatchObject({ is_kid: true, has_pin: false });
  });

  it("verifies PINs", async () => {
    const p = await create({ ...adult, pin: "1234" });
    expect((await t.api("POST", `/profiles/${p.id}/verify-pin`, { pin: "1234" })).body).toEqual({ ok: true });
    expect((await t.api("POST", `/profiles/${p.id}/verify-pin`, { pin: "0000" })).body).toEqual({ ok: false });
  });

  it("keeps at least one adult (delete and kid switch)", async () => {
    const onlyAdult = await create(adult);
    const k = await create(kid);

    expect((await t.api("DELETE", `/profiles/${onlyAdult.id}`)).status).toBe(409);
    expect((await t.api("PATCH", `/profiles/${onlyAdult.id}`, { is_kid: true })).status).toBe(409);

    expect((await t.api("DELETE", `/profiles/${k.id}`)).status).toBe(204);
    const list = profileListSchema.parse((await t.api("GET", "/profiles")).body);
    expect(list.map((p) => p.id)).toEqual([onlyAdult.id]);
  });

  it("returns 404 for unknown ids", async () => {
    expect((await t.api("PATCH", "/profiles/nope", { name: "x" })).status).toBe(404);
    expect((await t.api("DELETE", "/profiles/nope")).status).toBe(404);
  });
});
