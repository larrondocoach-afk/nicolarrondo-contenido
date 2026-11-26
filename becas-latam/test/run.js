// Prueba local sin red: reemplaza @vercel/blob por una memoria y Pipedrive por un fetch falso.
const Module = require("module");
const mem = new Map();
const fakeBlob = {
  put: async (p, body) => { mem.set(p, body); return { pathname: p }; },
  list: async ({ prefix }) => ({ blobs: [...mem.keys()].filter((k) => k.startsWith(prefix)).map((pathname) => ({ pathname })), hasMore: false }),
  get: async (p) => mem.has(p) ? { statusCode: 200, stream: (async function* () { yield Buffer.from(mem.get(p)); })() } : null,
  del: async (p) => { mem.delete(p); },
};
const orig = Module._load;
Module._load = function (req, ...a) { return req === "@vercel/blob" ? fakeBlob : orig.call(this, req, ...a); };

const calls = [];
global.fetch = async (url, opt = {}) => {
  calls.push([opt.method || "GET", url.split("?")[0], opt.body ? JSON.parse(opt.body) : null]);
  let data = {};
  if (url.includes("/persons/search")) data = { items: [] };
  else if (url.match(/persons\/\d+\/deals/)) data = null;
  else if (url.includes("/persons")) data = { id: 501 };
  else if (url.includes("/deals")) data = { id: 9001, pipeline_id: 2 };
  else if (url.includes("/notes")) data = { id: 1 };
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
};

process.env.CRM_PASSWORD = "clave-test";
process.env.MANYCHAT_SECRET = "mc-test";
process.env.PIPEDRIVE_API_TOKEN = "tok";
process.env.CLAUDE_CRM_KEY = "cl-test";

const call = (h, { method = "POST", body, query = {}, headers = {} }) => new Promise((resolve) => {
  const res = { code: 200, headers: {}, status(c) { this.code = c; return this; }, setHeader(k, v) { this.headers[k] = v; },
    json(o) { resolve({ code: this.code, body: o }); } };
  h({ method, body, query, headers }, res);
});
const assert = require("assert");
const lead = require("../api/lead"), mc = require("../api/manychat"), crm = require("../api/crm");
const adm = { "x-crm-key": "clave-test" };

(async () => {
  // 1. Landing
  let r = await call(lead, { body: { nombre: "Martina González", email: "Martina@Test.com", whatsapp: "+56 9 1111 2222", deporte: "Tenis",
    curso: "3° medio", pais: "Chile", nivel: "Federado / regional", notas: "Muy bien", ingles: "Intermedio", resultado: "Llamada de diagnóstico", utm_source: "ig" } });
  assert.equal(r.code, 200); assert.equal(r.body.nuevo, true);
  // honeypot
  r = await call(lead, { body: { nombre: "bot", email: "b@b.com", empresa: "x" } }); assert.equal(mem.size, 1);
  // 2. Manychat: misma persona por teléfono → no duplica
  r = await call(mc, { query: { key: "mc-test" }, body: { first_name: "Martina", phone: "+56911112222", ig_username: "martina.tenis", objetivo: "NCAA" } });
  assert.equal(r.code, 200); assert.equal(r.body.nuevo, false); assert.equal(mem.size, 1);
  r = await call(mc, { query: { key: "mala" }, body: {} }); assert.equal(r.code, 401);
  // Manychat solo con Instagram, dos veces → un lead
  await call(mc, { query: { key: "mc-test" }, body: { ig_username: "@pedro10", deporte: "Fútbol" } });
  r = await call(mc, { query: { key: "mc-test" }, body: { ig_username: "pedro10" } });
  assert.equal(r.body.nuevo, false); assert.equal(mem.size, 2);
  // 3. CRM
  r = await call(crm, { method: "GET", query: { accion: "leads" }, headers: {} }); assert.equal(r.code, 401);
  r = await call(crm, { method: "GET", query: { accion: "leads" }, headers: adm });
  assert.equal(r.body.leads.length, 2);
  const m = r.body.leads.find((l) => l.email === "martina@test.com");
  assert.equal(m.puntaje, 3 + 2 + 2 + 1); assert.equal(m.temperatura, "Caliente"); assert.equal(m.instagram, "martina.tenis");
  // manual
  r = await call(crm, { query: { accion: "guardar" }, headers: adm, body: { nombre: "Juan WhatsApp", whatsapp: "+54 11 5555 6666", fuente: "WhatsApp" } });
  assert.equal(r.body.lead.fuente, "WhatsApp"); assert.equal(mem.size, 3);
  // no se puede mandar sin calificar
  r = await call(crm, { query: { accion: "pipedrive" }, headers: adm, body: { id: m.id } }); assert.equal(r.code, 400);
  r = await call(crm, { query: { accion: "guardar" }, headers: adm, body: { id: m.id, estado: "Calificado", criterios: { presupuesto: true, llamada: true }, notasNico: "Familia lista", video: "https://youtu.be/x", anioIngreso: "2027" } });
  assert.equal(r.body.lead.estado, "Calificado"); assert.equal(r.body.lead.criterios.video, true);
  r = await call(crm, { query: { accion: "pipedrive" }, headers: adm, body: { id: m.id } });
  assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(r.body.lead.estado, "En Pipedrive"); assert.equal(r.body.lead.pipedrive.dealId, 9001);
  const deal = calls.find((c) => c[0] === "POST" && c[1].endsWith("/deals"))[2];
  assert.equal(deal.pipeline_id, 2); assert.equal(deal.stage_id, 14); assert.equal(deal.da5cdd8b4afac161bdf14c111481741fce669a0f, "Tennis");
  const note = calls.find((c) => c[1].endsWith("/notes"))[2]; assert.match(note.content, /Familia lista/);
  // borrar
  r = await call(crm, { query: { accion: "borrar" }, headers: adm, body: { id: m.id } }); assert.equal(mem.size, 2);
  // 4. Claude importa por GET
  const d = Buffer.from(JSON.stringify([{ nombre: "Lucas Pérez", whatsapp: "+56 9 3333 4444", deporte: "Fútbol", curso: "4° medio", nivel: "Club", notasNico: "Lo refirió Joao", seguimiento: "2026-11-28" }, { deporte: "x" }])).toString("base64url");
  r = await call(crm, { method: "GET", query: { accion: "importar", key: "mala", d } }); assert.equal(r.code, 401);
  r = await call(crm, { method: "GET", query: { accion: "importar", key: "cl-test", d } });
  assert.equal(r.body.resultados[0].ok, true); assert.equal(r.body.resultados[1].ok, false);
  r = await call(crm, { method: "GET", query: { accion: "resumen", key: "cl-test" } });
  const lucas = r.body.leads.find((l) => l.nombre === "Lucas Pérez");
  assert.equal(lucas.fuente, "WhatsApp"); assert.equal(lucas.seguimiento, "2026-11-28"); assert.match(lucas.notasNico, /Joao/);
  console.log("OK: todas las pruebas pasaron");
  console.log(calls.map((c) => c[0] + " " + c[1]).join("\n"));
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
