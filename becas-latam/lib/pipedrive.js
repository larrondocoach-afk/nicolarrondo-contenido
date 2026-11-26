// Pasa un lead calificado al Pipedrive de Venture Sports USA como trato en
// el embudo "LEADS", etapa "NEW PLAYER (LEAD)".
const API = "https://api.pipedrive.com/v1";
const DOMINIO = "https://venturesportsusa.pipedrive.com";

const PIPELINE_LEADS = 2;
const ETAPA_NEW_PLAYER = 14;
const CAMPO = {
  sports: "da5cdd8b4afac161bdf14c111481741fce669a0f",
  video: "aa9a6eb51273a073e01249263de8abde644fbb1a",
  placementYear: "6155af426f43bec83655c0441c51bd82808b4040",
};
const DEPORTE_EN = {
  "Fútbol": "Soccer", "Tenis": "Tennis", "Golf": "Golf", "Vóley": "Volleyball",
  "Natación": "Swimming", "Atletismo": "Track & Field", "Básquetbol": "Basketball", "Hockey": "Hockey",
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function pd(path, token, options = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${API}${path}${sep}api_token=${encodeURIComponent(token)}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(`Pipedrive ${options.method || "GET"} ${path.split("?")[0]} → ${res.status} ${json.error || ""}`);
  }
  return json.data;
}

async function buscarPersona(lead, token) {
  const terms = [lead.email, lead.whatsapp].filter(Boolean);
  for (const term of terms) {
    const field = term === lead.email ? "email" : "phone";
    const r = await pd(`/persons/search?term=${encodeURIComponent(term)}&fields=${field}&exact_match=true&limit=1`, token);
    const item = r?.items?.[0]?.item;
    if (item?.id) return item.id;
  }
  return null;
}

function notaHtml(lead) {
  const filas = [
    ["Fuente", lead.fuente], ["Completa", lead.quien], ["Deporte", lead.deporte], ["Curso", lead.curso],
    ["Edad", lead.edad], ["País", lead.pais], ["Nivel", lead.nivel], ["Colegio", lead.notas], ["Inglés", lead.ingles],
    ["Año de ingreso", lead.anioIngreso], ["Video", lead.video], ["WhatsApp", lead.whatsapp], ["Email", lead.email],
    ["Instagram", lead.instagram ? "@" + lead.instagram : ""],
    ["Puntaje", `${lead.puntaje}/10 (${lead.temperatura})`],
    ["Presupuesto confirmado", lead.criterios?.presupuesto ? "Sí" : "No"],
    ["Llamada de diagnóstico hecha", lead.criterios?.llamada ? "Sí" : "No"],
  ].filter(([, v]) => v);
  let html = `<b>Lead calificado por Nico (Venture Sports Latam)</b><br>` +
    filas.map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join("<br>");
  const extras = Object.entries(lead.respuestas || {}).filter(([, v]) => v);
  if (extras.length) html += "<br><br><b>Respuestas</b><br>" + extras.map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join("<br>");
  if (lead.notasNico) html += `<br><br><b>Notas de Nico</b><br>${esc(lead.notasNico).replace(/\n/g, "<br>")}`;
  return html;
}

async function enviarAPipedrive(lead) {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) throw new Error("Falta PIPEDRIVE_API_TOKEN en este entorno");

  let personId = await buscarPersona(lead, token);
  if (!personId) {
    const persona = await pd("/persons", token, {
      method: "POST",
      body: JSON.stringify({
        name: lead.nombre,
        ...(lead.email ? { email: [{ value: lead.email, primary: true, label: "home" }] } : {}),
        ...(lead.whatsapp ? { phone: [{ value: lead.whatsapp, primary: true, label: "mobile" }] } : {}),
      }),
    });
    personId = persona.id;
  }

  // Si la persona ya tiene un trato abierto en LEADS, no se crea otro: se le agrega la nota.
  const tratos = (await pd(`/persons/${personId}/deals?status=open&limit=50`, token)) || [];
  let deal = tratos.find((d) => d.pipeline_id === PIPELINE_LEADS);
  let yaExistia = Boolean(deal);

  if (!deal) {
    const payload = {
      title: `${lead.nombre}${lead.deporte ? " · " + lead.deporte : ""} (LATAM)`,
      person_id: personId,
      pipeline_id: PIPELINE_LEADS,
      stage_id: ETAPA_NEW_PLAYER,
      value: 0,
      currency: "USD",
    };
    if (lead.deporte) payload[CAMPO.sports] = DEPORTE_EN[lead.deporte] || lead.deporte;
    if (lead.video) payload[CAMPO.video] = lead.video;
    if (lead.anioIngreso) payload[CAMPO.placementYear] = String(lead.anioIngreso);
    deal = await pd("/deals", token, { method: "POST", body: JSON.stringify(payload) });
  }

  await pd("/notes", token, {
    method: "POST",
    body: JSON.stringify({ deal_id: deal.id, content: notaHtml(lead) }),
  });

  return { dealId: deal.id, personId, url: `${DOMINIO}/deal/${deal.id}`, yaExistia };
}

module.exports = { enviarAPipedrive };
