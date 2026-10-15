import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { profileListSchema, profileSchema, type ProfileCreate } from "../../shared/profile";
import { FAKE_WEBP, oversizedWebp } from "../test/fakeUpload";
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
  study_langs: ["ko", "en"],
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
    expect(p).toMatchObject({ name: "Bố", has_pin: true, study_langs: ["ko", "en"] });

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

describe("profile avatar photo (M2.10)", () => {
  const upload = (id: string, actorId: string, body: Uint8Array, type = "image/webp") =>
    t.send(`/api/profiles/${id}/avatar-photo?profile_id=${actorId}`, { method: "POST", headers: { "content-type": type }, body });
  const remove = (id: string, actorId: string) =>
    t.send(`/api/profiles/${id}/avatar-photo?profile_id=${actorId}`, { method: "DELETE" });

  it("an adult can upload a photo; it takes over from the emoji, bad files are refused", async () => {
    const p = await create(adult);

    expect((await upload(p.id, p.id, FAKE_WEBP, "image/png")).status).toBe(400); // type does not match the bytes
    expect((await upload(p.id, p.id, oversizedWebp())).status).toBe(400);

    const ok = await upload(p.id, p.id, FAKE_WEBP);
    expect(ok.status).toBe(200);
    const body = profileSchema.parse(await ok.json());
    expect(body.avatar_photo).toMatch(/^images\/upload\/[0-9a-f]{40}\.webp$/);

    const media = await t.raw(`/api/media/${body.avatar_photo}`);
    expect(media.status).toBe(200);
  });

  it("a kid profile cannot upload or remove a photo (even its own)", async () => {
    const a = await create(adult);
    const k = await create(kid);
    expect((await upload(k.id, k.id, FAKE_WEBP)).status).toBe(403);
    expect((await remove(a.id, k.id)).status).toBe(403);
  });

  it("removing a photo reverts to the emoji; a key shared with a word image is kept in R2", async () => {
    const a = await create(adult);
    const b = await create({ ...adult, name: "Mẹ" });

    const res1 = await upload(a.id, a.id, FAKE_WEBP);
    const key = profileSchema.parse(await res1.json()).avatar_photo!;
    await upload(b.id, a.id, FAKE_WEBP); // the exact same bytes → the exact same content-addressed key

    const removed = await remove(a.id, a.id);
    expect(removed.status).toBe(200);
    expect(profileSchema.parse(await removed.json()).avatar_photo).toBeNull();

    // b's profile (and the R2 object itself) are unaffected by a's removal.
    const list = profileListSchema.parse((await t.api("GET", "/profiles")).body);
    expect(list.find((p) => p.id === b.id)?.avatar_photo).toBe(key);
    expect((await t.raw(`/api/media/${key}`)).status).toBe(200);
  });

  it("returns 404 for an unknown profile id", async () => {
    const a = await create(adult);
    expect((await upload("nope", a.id, FAKE_WEBP)).status).toBe(404);
    expect((await remove("nope", a.id)).status).toBe(404);
  });
});
