// Recibe la evaluación de la landing y la guarda en el CRM propio de Nico.
// Ya no se manda a Pipedrive: solo pasan a Pipedrive los leads que Nico califica desde /crm.
const { body } = require("../lib/http");
const { upsertLead } = require("../lib/leads");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false });
  }

  const b = body(req);

  // Honeypot anti-spam: si viene lleno, respondemos ok y no guardamos nada.
  if (b.empresa) return res.status(200).json({ ok: true });

  if (!b.nombre || (!b.email && !b.whatsapp)) {
    return res.status(400).json({ ok: false, error: "faltan datos" });
  }

  try {
    const { lead, nuevo } = await upsertLead(b, {
      fuente: "Web",
      respuestas: {
        "Resultado": b.resultado,
        "Completa": b.quien,
        "Página": b.pagina,
      },
      utm: {
        source: b.utm_source, medium: b.utm_medium,
        campaign: b.utm_campaign, content: b.utm_content,
      },
      nota: `Completó la evaluación web (${b.resultado || "sin resultado"})`,
    });
    return res.status(200).json({ ok: true, nuevo, id: lead.id });
  } catch (err) {
    console.error("lead:", err);
    return res.status(500).json({ ok: false });
  }
};
