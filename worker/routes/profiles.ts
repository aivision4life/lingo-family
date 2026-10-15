import { count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { ApiErrorBody } from "../../shared/api/error";
import { IMAGE_ERRORS, imageProfileRequestSchema } from "../../shared/image";
import {
  PROFILE_ERRORS,
  profileCreateSchema,
  profileUpdateSchema,
  verifyPinRequestSchema,
  type Profile,
} from "../../shared/profile";
import { profiles } from "../../db/schema";
import { getDb, type AppEnv } from "../env";
import { requireAdult } from "../lib/access";
import { hashPin, verifyPin } from "../lib/pin";
import { zv } from "../lib/validate";
import { storeUploadedImage } from "../services/imageUpload";

type ProfileRow = typeof profiles.$inferSelect;

/** Strips the PIN hash before anything leaves the server. */
const toDto = ({ pin_hash, created_at, ...rest }: ProfileRow): Profile => ({
  ...rest,
  has_pin: pin_hash !== null,
  created_at: created_at.getTime(),
});

const idParam = zv("param", z.object({ id: z.string().min(1) }));
const err = (error: string): ApiErrorBody => ({ error });

const countAdults = async (db: ReturnType<typeof getDb>) => {
  const [row] = await db.select({ n: count() }).from(profiles).where(eq(profiles.is_kid, false));
  return row?.n ?? 0;
};

export const profileRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows = await getDb(c.env).select().from(profiles).orderBy(profiles.created_at);
    return c.json(rows.map(toDto));
  })

  .post("/", zv("json", profileCreateSchema), async (c) => {
    const db = getDb(c.env);
    const { pin, ...input } = c.req.valid("json");
    // Invariant: whenever profiles exist, at least one of them is an adult.
    if (input.is_kid && (await countAdults(db)) === 0) {
      return c.json(err(PROFILE_ERRORS.lastAdult), 409);
    }
    const [row] = await db
      .insert(profiles)
      .values({ ...input, pin_hash: pin ? await hashPin(pin) : null })
      .returning();
    return c.json(toDto(row!), 201);
  })

  .patch("/:id", idParam, zv("json", profileUpdateSchema), async (c) => {
    const db = getDb(c.env);
    const { id } = c.req.valid("param");
    const { pin, ...input } = c.req.valid("json");

    const existing = await db.select().from(profiles).where(eq(profiles.id, id)).get();
    if (!existing) return c.json(err("not_found"), 404);

    const becomesKid = input.is_kid === true && !existing.is_kid;
    if (becomesKid && (await countAdults(db)) <= 1) {
      return c.json(err(PROFILE_ERRORS.lastAdult), 409);
    }

    // Kid profiles never keep a PIN.
    const isKid = input.is_kid ?? existing.is_kid;
    let pin_hash = existing.pin_hash;
    if (isKid || pin === null) pin_hash = null;
    else if (pin !== undefined) pin_hash = await hashPin(pin);

    const [row] = await db
      .update(profiles)
      .set({ ...input, pin_hash })
      .where(eq(profiles.id, id))
      .returning();
    return c.json(toDto(row!));
  })

  .delete("/:id", idParam, async (c) => {
    const db = getDb(c.env);
    const { id } = c.req.valid("param");

    const existing = await db.select().from(profiles).where(eq(profiles.id, id)).get();
    if (!existing) return c.json(err("not_found"), 404);
    if (!existing.is_kid && (await countAdults(db)) <= 1) {
      return c.json(err(PROFILE_ERRORS.lastAdult), 409);
    }

    // Cards, review logs, attempts and usage rows are removed by ON DELETE CASCADE.
    await db.delete(profiles).where(eq(profiles.id, id));
    return c.body(null, 204);
  })

  /** "My photo" for a profile avatar (M2.10): already resized in the browser. Adults only. */
  .post("/:id/avatar-photo", idParam, zv("query", imageProfileRequestSchema), async (c) => {
    const db = getDb(c.env);
    const { id } = c.req.valid("param");
    const { profile_id } = c.req.valid("query");
    const denied = await requireAdult(c, profile_id);
    if (denied) return denied;
    const existing = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, id)).get();
    if (!existing) return c.json(err("not_found"), 404);

    const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const stored = await storeUploadedImage(c.env.MEDIA, bytes, type);
    if (!stored) return c.json(err(IMAGE_ERRORS.invalidUpload), 400);

    const [row] = await db.update(profiles).set({ avatar_photo: stored.key }).where(eq(profiles.id, id)).returning();
    return c.json(toDto(row!));
  })

  /** Removes the avatar photo (back to the emoji). The R2 object itself is content-addressed and
   * may be shared with a word/phrase/example image, so it is never deleted here. */
  .delete("/:id/avatar-photo", idParam, zv("query", imageProfileRequestSchema), async (c) => {
    const db = getDb(c.env);
    const { id } = c.req.valid("param");
    const { profile_id } = c.req.valid("query");
    const denied = await requireAdult(c, profile_id);
    if (denied) return denied;
    const existing = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, id)).get();
    if (!existing) return c.json(err("not_found"), 404);

    const [row] = await db.update(profiles).set({ avatar_photo: null }).where(eq(profiles.id, id)).returning();
    return c.json(toDto(row!));
  })

  .post("/:id/verify-pin", idParam, zv("json", verifyPinRequestSchema), async (c) => {
    const { id } = c.req.valid("param");
    const { pin } = c.req.valid("json");
    const existing = await getDb(c.env).select().from(profiles).where(eq(profiles.id, id)).get();
    if (!existing) return c.json(err("not_found"), 404);
    const ok = existing.pin_hash === null || (await verifyPin(pin, existing.pin_hash));
    return c.json({ ok });
  });
