// Entrada para Manychat (Instagram). En Manychat: acción "External Request" (plan Pro),
// método POST a https://becas-latam.vercel.app/api/manychat?key=<MANYCHAT_SECRET>, con un JSON
// que tenga los datos del contacto. Ver becas-latam/README.md.
const { body, sameSecret } = require("../lib/http");
const { upsertLead, CAMPOS } = require("../lib/leads");

const ALIAS = {
  name: "nombre", full_name: "nombre", nombre_completo: "nombre",
  phone: "whatsapp", telefono: "whatsapp", "teléfono": "whatsapp", celular: "whatsapp",
  ig_username: "instagram", ig: "instagram", usuario_instagram: "instagram",
  sport: "deporte", country: "pais", "país": "pais", level: "nivel",
  english: "ingles", "inglés": "ingles", grades: "notas",
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false });
  }
  const key = req.query?.key || req.headers["x-manychat-key"];
  if (!sameSecret(key, process.env.MANYCHAT_SECRET)) {
    return res.status(401).json({ ok: false });
  }

  const raw = body(req);
  const datos = {};
  const respuestas = {};
  for (const [k0, v] of Object.entries(raw)) {
    if (v === null || v === undefined || v === "") continue;
    const k = ALIAS[k0.toLowerCase()] || k0;
    if (CAMPOS.includes(k)) datos[k] = v;
    else if (!["first_name", "last_name", "key", "nota"].includes(k0)) respuestas[k0] = String(v).slice(0, 500);
  }
  if (!datos.nombre && (raw.first_name || raw.last_name)) {
    datos.nombre = [raw.first_name, raw.last_name].filter(Boolean).join(" ");
  }
  if (!datos.nombre) datos.nombre = datos.instagram ? "@" + String(datos.instagram).replace(/^@/, "") : "Sin nombre (Instagram)";

  try {
    const { lead, nuevo } = await upsertLead(datos, {
      fuente: "Instagram",
      respuestas,
      nota: raw.nota ? String(raw.nota).slice(0, 300) : "Llegó por Manychat (Instagram)",
    });
    return res.status(200).json({ ok: true, nuevo, id: lead.id });
  } catch (err) {
    console.error("manychat:", err);
    return res.status(500).json({ ok: false });
  }
};
