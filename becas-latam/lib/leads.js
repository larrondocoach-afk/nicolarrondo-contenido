// Reglas del CRM: campos, puntaje y alta/actualización de leads.
const { leadIdFor, getLead, saveLead, listLeads, clip, digits, normEmail } = require("./store");

const ESTADOS = ["Nuevo", "Contactado", "Llamada agendada", "Llamada hecha", "Calificado", "En Pipedrive", "Descartado"];
const FUENTES = ["Web", "Instagram", "WhatsApp", "Referido", "Otro"];

// Campos que el lead (o Nico) puede llenar.
const CAMPOS = [
  "nombre", "email", "whatsapp", "instagram", "quien", "deporte", "curso", "pais",
  "nivel", "notas", "ingles", "video", "anioIngreso", "edad",
];

const CURSO_PTS = {
  "7° básico o menos": 0, "8° básico": 0, "1° medio": 1, "2° medio": 3,
  "3° medio": 3, "4° medio": 3, "Egresado/a": 2,
};
const NIVEL_PTS = { "Colegio": 0, "Club": 1, "Federado / regional": 2, "Selección nacional": 3, "Universidad": 2 };
const NOTAS_PTS = { "Regular": 0, "Bien": 1, "Muy bien": 2 };
const INGLES_PTS = { "Básico": 0, "Intermedio": 1, "Avanzado": 2 };

// Puntaje de 0 a 10 con las respuestas de la evaluación. Solo sirve para ordenar a quién llamar primero.
function puntuar(l) {
  const p =
    (CURSO_PTS[l.curso] ?? 0) +
    (NIVEL_PTS[l.nivel] ?? 0) +
    (NOTAS_PTS[l.notas] ?? 0) +
    (INGLES_PTS[l.ingles] ?? 0);
  const temperatura = p >= 7 ? "Caliente" : p >= 4 ? "Tibio" : "Frío";
  return { puntaje: p, temperatura };
}

function limpiar(input) {
  const out = {};
  for (const k of CAMPOS) {
    if (input[k] !== undefined && input[k] !== null && String(input[k]).trim() !== "") {
      out[k] = clip(input[k], k === "video" ? 500 : 200);
    }
  }
  if (out.email) out.email = normEmail(out.email);
  if (out.instagram) out.instagram = out.instagram.replace(/^@/, "");
  return out;
}

// Busca a la misma persona aunque haya llegado antes por otra vía (ej: primero Instagram, después la web).
async function buscarDuplicado(d) {
  const tel = digits(d.whatsapp);
  const ig = (d.instagram || "").toLowerCase();
  if (!d.email && tel.length < 8 && !ig) return null;
  const todos = await listLeads();
  return (
    todos.find(
      (l) =>
        (d.email && l.email === d.email) ||
        (tel.length >= 8 && digits(l.whatsapp) === tel) ||
        (ig && (l.instagram || "").toLowerCase() === ig)
    ) || null
  );
}

// Crea el lead o, si la persona ya existe (mismo email o teléfono), actualiza su ficha.
async function upsertLead(input, { fuente = "Otro", respuestas = {}, utm = {}, nota } = {}) {
  const datos = limpiar(input);
  const id = input.id && /^[a-f0-9]{16}$/.test(input.id) ? input.id : leadIdFor(datos);
  const ahora = new Date().toISOString();
  let previo = await getLead(id);
  if (!previo) previo = await buscarDuplicado(datos);

  const lead = previo || {
    id,
    creado: ahora,
    fuente: FUENTES.includes(fuente) ? fuente : "Otro",
    estado: "Nuevo",
    criterios: { presupuesto: false, video: false, llamada: false },
    notasNico: "",
    seguimiento: "",
    historial: [],
    respuestas: {},
    utm: {},
  };

  Object.assign(lead, datos);
  lead.respuestas = { ...lead.respuestas, ...respuestas };
  for (const [k, v] of Object.entries(utm)) if (v) lead.utm[k] = clip(v, 120);
  if (lead.video) lead.criterios.video = true;

  lead.historial.push({
    fecha: ahora,
    texto: nota || (previo ? `Volvió a llegar por ${fuente}` : `Entró por ${fuente}`),
  });
  if (lead.historial.length > 100) lead.historial = lead.historial.slice(-100);

  Object.assign(lead, puntuar(lead));
  await saveLead(lead);
  return { lead, nuevo: !previo };
}

module.exports = { ESTADOS, FUENTES, CAMPOS, puntuar, limpiar, upsertLead };
