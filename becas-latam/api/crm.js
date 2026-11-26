// API privada del panel /crm. Todas las acciones piden la clave (encabezado x-crm-key).
//   GET  /api/crm?accion=leads           → lista de leads
//   POST /api/crm?accion=guardar         → crea (manual) o actualiza un lead
//   POST /api/crm?accion=pipedrive       → manda un lead calificado a Pipedrive
//   POST /api/crm?accion=borrar          → borra un lead
const { body, isAdmin, sameSecret } = require("../lib/http");
const { listLeads, getLead, saveLead, deleteLead, clip } = require("../lib/store");
const { ESTADOS, FUENTES, CAMPOS, upsertLead, limpiar, puntuar } = require("../lib/leads");
const { enviarAPipedrive } = require("../lib/pipedrive");

// Acceso para Claude (cargar leads que Nico le dicta por chat y leer el CRM), con su propia clave:
//   GET /api/crm?accion=importar&key=CLAUDE_CRM_KEY&d=<JSON en base64url: un lead o una lista>
//   GET /api/crm?accion=resumen&key=CLAUDE_CRM_KEY
async function claude(req, res) {
  const accion = req.query.accion;
  if (accion === "resumen") {
    const leads = await listLeads();
    leads.sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
    return res.json({ ok: true, leads });
  }
  let data;
  try { data = JSON.parse(Buffer.from(String(req.query.d || ""), "base64url").toString("utf8")); }
  catch { return res.status(400).json({ ok: false, error: "d inválido" }); }
  const lista = (Array.isArray(data) ? data : [data]).slice(0, 50);
  const resultados = [];
  for (const item of lista) {
    if (!item || !item.nombre) { resultados.push({ ok: false, error: "Falta el nombre" }); continue; }
    const { lead, nuevo } = await upsertLead(item, {
      fuente: FUENTES.includes(item.fuente) ? item.fuente : "WhatsApp",
      respuestas: item.respuestas && typeof item.respuestas === "object" ? item.respuestas : {},
      nota: item.nota ? clip(item.nota, 300) : "Cargado por Claude desde el chat",
    });
    if (item.notasNico) { lead.notasNico = [lead.notasNico, clip(item.notasNico, 2000)].filter(Boolean).join("\n"); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(item.seguimiento || "")) lead.seguimiento = item.seguimiento;
    if (ESTADOS.includes(item.estado) && item.estado !== "En Pipedrive") lead.estado = item.estado;
    await saveLead(lead);
    resultados.push({ ok: true, nuevo, id: lead.id, nombre: lead.nombre, puntaje: lead.puntaje, temperatura: lead.temperatura });
  }
  return res.json({ ok: true, resultados });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET" && ["importar", "resumen"].includes(req.query?.accion)) {
    if (!sameSecret(req.query.key, process.env.CLAUDE_CRM_KEY)) return res.status(401).json({ ok: false });
    try { return await claude(req, res); }
    catch (err) { console.error("crm/claude:", err); return res.status(500).json({ ok: false, error: String(err.message || err).slice(0, 300) }); }
  }
  if (!process.env.CRM_PASSWORD) return res.status(500).json({ ok: false, error: "Falta CRM_PASSWORD" });
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Clave incorrecta" });

  const accion = req.query?.accion;
  try {
    if (req.method === "GET" && accion === "leads") {
      const leads = await listLeads();
      leads.sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
      return res.json({ ok: true, leads, estados: ESTADOS, fuentes: FUENTES });
    }

    if (req.method !== "POST") return res.status(405).json({ ok: false });
    const b = body(req);

    if (accion === "guardar") {
      // Lead nuevo cargado a mano (WhatsApp, referido, etc.)
      if (!b.id) {
        if (!b.nombre) return res.status(400).json({ ok: false, error: "Falta el nombre" });
        const { lead } = await upsertLead(b, { fuente: b.fuente || "WhatsApp", nota: "Cargado a mano en el CRM" });
        return res.json({ ok: true, lead });
      }

      const lead = await getLead(b.id);
      if (!lead) return res.status(404).json({ ok: false, error: "No existe" });

      const antes = lead.estado;
      const videoAntes = lead.video;
      if (ESTADOS.includes(b.estado)) lead.estado = b.estado;
      if (FUENTES.includes(b.fuente)) lead.fuente = b.fuente;
      if (b.criterios && typeof b.criterios === "object") {
        for (const k of ["presupuesto", "video", "llamada"]) {
          if (k in b.criterios) lead.criterios[k] = Boolean(b.criterios[k]);
        }
      }
      for (const k of CAMPOS) if (k in b && String(b[k] ?? "").trim() === "" && k !== "nombre") delete lead[k];
      Object.assign(lead, limpiar(b));
      if (lead.video && lead.video !== videoAntes) lead.criterios.video = true; // pegó un link de video nuevo
      if ("notasNico" in b) lead.notasNico = clip(b.notasNico, 5000);
      if ("seguimiento" in b) lead.seguimiento = /^\d{4}-\d{2}-\d{2}$/.test(b.seguimiento) ? b.seguimiento : "";
      if (antes !== lead.estado) {
        lead.historial.push({ fecha: new Date().toISOString(), texto: `Estado: ${antes} → ${lead.estado}` });
      }
      Object.assign(lead, puntuar(lead));
      await saveLead(lead);
      return res.json({ ok: true, lead });
    }

    if (accion === "pipedrive") {
      const lead = await getLead(b.id);
      if (!lead) return res.status(404).json({ ok: false, error: "No existe" });
      if (lead.estado !== "Calificado" && lead.estado !== "En Pipedrive") {
        return res.status(400).json({ ok: false, error: "Primero marca el lead como Calificado" });
      }
      const r = await enviarAPipedrive(lead);
      lead.pipedrive = { ...r, fecha: new Date().toISOString() };
      lead.estado = "En Pipedrive";
      lead.historial.push({
        fecha: lead.pipedrive.fecha,
        texto: r.yaExistia ? `Ya tenía trato en Pipedrive (#${r.dealId}); se agregó una nota` : `Enviado a Pipedrive (trato #${r.dealId})`,
      });
      await saveLead(lead);
      return res.json({ ok: true, lead });
    }

    if (accion === "borrar") {
      await deleteLead(String(b.id || ""));
      return res.json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: "Acción desconocida" });
  } catch (err) {
    console.error("crm:", err);
    return res.status(500).json({ ok: false, error: String(err.message || err).slice(0, 300) });
  }
};
