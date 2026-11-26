# Becas LATAM: landing + CRM propio

Landing de becas deportivas (https://becas-latam.vercel.app) y el CRM de Nico para ordenar sus leads.
Todos los leads entran al CRM; solo los que Nico califica pasan al Pipedrive de Venture Sports USA.

## Piezas

| Archivo | Qué hace |
|---|---|
| `api/lead.js` | Recibe la evaluación de la landing y la guarda en el CRM (fuente "Web"). Ya no la manda directo a Pipedrive. |
| `api/manychat.js` | Entrada para Manychat / Instagram (fuente "Instagram"). Pide `?key=MANYCHAT_SECRET`. |
| `api/crm.js` | API del panel (clave `CRM_PASSWORD` en el encabezado `x-crm-key`): listar, guardar, borrar y enviar a Pipedrive. También `importar` y `resumen` por GET con `CLAUDE_CRM_KEY`, para que Claude cargue los leads que Nico le dicta por chat. |
| `crm/index.html` | El panel en `/crm/`: lista, filtros por estado, fuente y puntaje, ficha del lead, notas, seguimiento y botón "Enviar a Pipedrive". |
| `lib/store.js` | Guarda cada lead como un JSON privado en Vercel Blob (`leads/<id>.json`). |
| `lib/leads.js` | Estados, puntaje (0 a 10) y la regla para no duplicar personas (mismo email, teléfono o Instagram). |
| `lib/pipedrive.js` | Crea la persona (o usa la que ya existe) y un trato en el embudo LEADS, etapa NEW PLAYER (LEAD), con deporte, video, año de ingreso y una nota con todo. Si la persona ya tiene un trato abierto en LEADS, solo le agrega la nota. |

Variables de entorno en Vercel: `BLOB_READ_WRITE_TOKEN` (la crea el Blob store `crm-leads-latam`), `CRM_PASSWORD`,
`MANYCHAT_SECRET`, `CLAUDE_CRM_KEY` y `PIPEDRIVE_API_TOKEN` (este último solo en producción).

## Conectar Manychat (plan Pro)

En el flujo de Instagram, justo después de que la persona termina la encuesta, agrega la acción **External Request**:

- **Request type:** `POST`
- **URL:** `https://becas-latam.vercel.app/api/manychat?key=<MANYCHAT_SECRET>`
- **Body:** JSON con los campos del contacto. Los nombres de la derecha son los campos de tu cuenta de Manychat,
  así que cámbialos por los tuyos:

```json
{
  "first_name": "{{first_name}}",
  "last_name": "{{last_name}}",
  "ig_username": "{{ig_username}}",
  "phone": "{{phone}}",
  "email": "{{email}}",
  "deporte": "{{deporte}}",
  "curso": "{{curso}}",
  "pais": "{{pais}}",
  "nivel": "{{nivel}}",
  "nota": "Pasó la encuesta de Manychat"
}
```

Cualquier otro campo que mandes queda guardado en "Respuestas de la encuesta" de la ficha.
La misma persona no se duplica: se reconoce por email, teléfono o usuario de Instagram.

## Archivos que no están en este repo

`index.html`, `script.js`, `styles.css` y `assets/` de la landing viven hoy solo en el deployment de Vercel
(se subieron con la CLI). `static-files.json` tiene sus SHA1 para reusarlos al publicar. Si publicas con la CLI
desde tu carpeta local de la landing, copia ahí `api/`, `lib/`, `crm/`, `package.json` y `vercel.json`.

## Pruebas

`npm install && node test/run.js` prueba todo el flujo sin red (Blob y Pipedrive simulados).
