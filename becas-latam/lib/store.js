// Almacenamiento de leads en Vercel Blob (privado). Un archivo JSON por lead: leads/<id>.json
const crypto = require("crypto");
const { put, list, get, del } = require("@vercel/blob");

const PREFIX = "leads/";

const clip = (s, n = 300) => String(s ?? "").trim().slice(0, n);
const digits = (s) => String(s ?? "").replace(/\D/g, "");
const normEmail = (s) => clip(s, 200).toLowerCase();

// El id sale del email (o del teléfono) para que la misma persona no se duplique.
function leadIdFor({ email, whatsapp, instagram }) {
  const ig = clip(instagram, 100).toLowerCase().replace(/^@/, "");
  const key =
    normEmail(email) ||
    (digits(whatsapp).length >= 8 ? "tel:" + digits(whatsapp) : "") ||
    (ig ? "ig:" + ig : "");
  const base = key || "rand:" + crypto.randomUUID();
  return crypto.createHash("sha1").update(base).digest("hex").slice(0, 16);
}

async function readStream(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}

async function getLead(id) {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  const r = await get(PREFIX + id + ".json", { access: "private", useCache: false }).catch(() => null);
  if (!r || r.statusCode !== 200) return null;
  try { return JSON.parse(await readStream(r.stream)); } catch { return null; }
}

async function saveLead(lead) {
  lead.actualizado = new Date().toISOString();
  await put(PREFIX + lead.id + ".json", JSON.stringify(lead), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
  return lead;
}

async function listLeads() {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const out = [];
  const queue = [...blobs];
  const worker = async () => {
    while (queue.length) {
      const b = queue.shift();
      const r = await get(b.pathname, { access: "private", useCache: false }).catch(() => null);
      if (r && r.statusCode === 200) {
        try { out.push(JSON.parse(await readStream(r.stream))); } catch {}
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out;
}

async function deleteLead(id) {
  if (!/^[a-f0-9]{16}$/.test(id)) return;
  await del(PREFIX + id + ".json");
}

module.exports = { leadIdFor, getLead, saveLead, listLeads, deleteLead, clip, digits, normEmail };
