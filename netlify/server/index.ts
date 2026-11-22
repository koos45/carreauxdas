import { Hono } from "hono";
import { getStore } from "@netlify/blobs";
import { eq, desc } from "drizzle-orm";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { db } from "../../db/index.ts";
import { customProducts, stockOverrides, hiddenProducts, customSupplies, quoteRequests } from "../../db/schema.ts";

const app = new Hono();
const photos = () => getStore("product-photos");

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

function isAdmin(password: string | undefined): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !password) return false;
  const a = Buffer.from(password.trim());
  const b = Buffer.from(expected.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

const requireAdmin = async (c: any, next: () => Promise<void>) => {
  if (!process.env.ADMIN_PASSWORD) {
    return c.json({ error: "ADMIN_PASSWORD non configuré sur Netlify." }, 503);
  }
  if (!isAdmin(c.req.header("x-admin-password"))) {
    return c.json({ error: "Mot de passe gérant incorrect." }, 401);
  }
  await next();
};

const str = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);
const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

function sanitizeProduct(p: any) {
  const images = Array.isArray(p?.images)
    ? p.images.map((u: unknown) => str(u, 600)).filter((u: string) => u.startsWith("/api/photos/") || u.startsWith("https://"))
    : [];
  return {
    id: str(p?.id, 80),
    name: str(p?.name, 120),
    category: str(p?.category, 60),
    format: str(p?.format, 60),
    discount: str(p?.discount, 10) || "-30%",
    oldPrice: num(p?.oldPrice, 0),
    priceSupply: num(p?.priceSupply, 0),
    pricePose: num(p?.pricePose, 0),
    boxSqm: num(p?.boxSqm, 1.44),
    norm: str(p?.norm, 120),
    inStock: p?.inStock !== false,
    images,
    desc: str(p?.desc, 2000),
  };
}

function sanitizeSupply(s: any) {
  const image = str(s?.image, 600);
  const domain = str(s?.domain || s?.desc, 2000);
  const specs = str(s?.specs, 2000);
  return {
    id: str(s?.id, 80),
    name: str(s?.name, 120),
    subtitle: str(s?.subtitle, 200),
    price: num(s?.price, 0),
    image: image.startsWith("/api/photos/") || image.startsWith("https://") ? image : "",
    domain,
    specs,
    desc: domain,
  };
}

// Catalogue public
app.get("/api/catalog", async (c) => {
  const [rows, stock, hidden, suppliesRows] = await Promise.all([
    db.select().from(customProducts).orderBy(desc(customProducts.createdAt)),
    db.select().from(stockOverrides),
    db.select().from(hiddenProducts),
    db.select().from(customSupplies),
  ]);
  c.header("Cache-Control", "no-store");
  return c.json({
    products: rows.map((r) => r.data),
    stock: Object.fromEntries(stock.map((s) => [s.productId, s.inStock])),
    hiddenIds: hidden.map((h) => h.productId),
    supplies: suppliesRows.map((s) => s.data),
  });
});

// Enregistrement d'une demande de devis client + notification email (si RESEND_API_KEY est configurée)
app.post("/api/quotes", async (c) => {
  const body = await c.req.json().catch(() => null);
  const clientName = str(body?.clientName, 120) || "Non renseigné";
  const clientContact = str(body?.clientContact, 160);
  const clientCity = str(body?.clientCity, 120);
  const totalEstime = str(body?.totalEstime, 80) || "Sur devis";
  const detail = str(body?.detail, 4000);

  if (!clientContact || !detail) {
    return c.json({ error: "Contact et détail de la demande obligatoires." }, 400);
  }

  const id = `devis-${Date.now()}-${randomUUID().slice(0, 6)}`;
  await db.insert(quoteRequests).values({
    id,
    clientName,
    clientContact,
    clientCity,
    totalEstime,
    detail,
  });

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Carreaux Das <onboarding@resend.dev>",
        to: ["koos45120@gmail.com"],
        subject: `Nouveau devis Carreaux Das - ${clientName} (${totalEstime})`,
        text: `Nouvelle demande de devis reçue sur carreauxdas.net :\n\nClient : ${clientName}\nContact : ${clientContact}\nVille / CP : ${clientCity || "Non renseignée"}\nTotal estimé : ${totalEstime}\n\nDétail :\n${detail}`,
      }),
    }).catch((err) => console.error("Resend error:", err));
  }

  return c.json({ ok: true, id }, 201);
});

// Lecture et suppression des devis dans l'espace gérant
app.get("/api/admin/quotes", requireAdmin, async (c) => {
  const rows = await db.select().from(quoteRequests).orderBy(desc(quoteRequests.createdAt));
  return c.json(rows);
});

app.delete("/api/admin/quotes/:id", requireAdmin, async (c) => {
  const id = str(c.req.param("id"), 80);
  await db.delete(quoteRequests).where(eq(quoteRequests.id, id));
  return c.json({ ok: true });
});

// Photos publiques
app.get("/api/photos/:key", async (c) => {
  const result = await photos().getWithMetadata(c.req.param("key"), { type: "arrayBuffer" });
  if (!result) return c.text("Photo introuvable", 404);
  return new Response(result.data, {
    headers: {
      "Content-Type": String(result.metadata?.contentType || "image/jpeg"),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

app.post("/api/admin/check", requireAdmin, (c) => c.json({ ok: true }));

app.post("/api/admin/photos", requireAdmin, async (c) => {
  const { dataUrl } = await c.req.json().catch(() => ({}));
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match) return c.json({ error: "Photo invalide." }, 400);
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_PHOTO_BYTES) return c.json({ error: "Photo trop lourde." }, 413);
  const ext = match[1].split("/")[1].replace("jpeg", "jpg");
  const key = `${randomUUID()}.${ext}`;
  await photos().set(key, bytes, { metadata: { contentType: match[1] } });
  return c.json({ url: `/api/photos/${key}` }, 201);
});

app.post("/api/admin/products", requireAdmin, async (c) => {
  const product = sanitizeProduct(await c.req.json().catch(() => null));
  if (!product.id || !product.name) return c.json({ error: "Modèle incomplet." }, 400);
  if (product.images.length === 0) return c.json({ error: "Au moins une photo est requise." }, 400);
  await db
    .insert(customProducts)
    .values({ id: product.id, data: product })
    .onConflictDoUpdate({ target: customProducts.id, set: { data: product } });
  return c.json(product, 201);
});

app.delete("/api/admin/products/:id", requireAdmin, async (c) => {
  const id = str(c.req.param("id"), 80);
  const [row] = await db.select().from(customProducts).where(eq(customProducts.id, id));
  await db.delete(customProducts).where(eq(customProducts.id, id));
  await db.delete(stockOverrides).where(eq(stockOverrides.productId, id));
  if (!id.startsWith("custom-")) {
    await db.insert(hiddenProducts).values({ productId: id }).onConflictDoNothing();
  }
  const images: string[] = (row?.data as any)?.images || [];
  await Promise.all(
    images.filter((u) => u.startsWith("/api/photos/")).map((u) => photos().delete(u.slice("/api/photos/".length)))
  );
  return c.json({ ok: true });
});

app.put("/api/admin/stock/:id", requireAdmin, async (c) => {
  const productId = str(c.req.param("id"), 80);
  const { inStock } = await c.req.json().catch(() => ({}));
  const value = Boolean(inStock);
  await db
    .insert(stockOverrides)
    .values({ productId, inStock: value })
    .onConflictDoUpdate({ target: stockOverrides.productId, set: { inStock: value, updatedAt: new Date() } });
  return c.json({ productId, inStock: value });
});

app.post("/api/admin/supplies", requireAdmin, async (c) => {
  const supply = sanitizeSupply(await c.req.json().catch(() => null));
  if (!supply.id || !supply.name) return c.json({ error: "Fourniture incomplète." }, 400);
  await db
    .insert(customSupplies)
    .values({ id: supply.id, data: supply, updatedAt: new Date() })
    .onConflictDoUpdate({ target: customSupplies.id, set: { data: supply, updatedAt: new Date() } });
  return c.json(supply, 201);
});

app.delete("/api/admin/supplies/:id", requireAdmin, async (c) => {
  const id = str(c.req.param("id"), 80);
  const [row] = await db.select().from(customSupplies).where(eq(customSupplies.id, id));
  await db.delete(customSupplies).where(eq(customSupplies.id, id));
  const image: string = (row?.data as any)?.image || "";
  if (image.startsWith("/api/photos/")) {
    await photos().delete(image.slice("/api/photos/".length));
  }
  return c.json({ ok: true });
});

export const config = { path: "/api/*" };

export default app;
