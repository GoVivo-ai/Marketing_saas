# Importación del Excel maestro de leads ("New Lead Management")

Análisis del archivo maestro del equipo de ops (2026-06) y diseño del
normalizador que lo migra a la plataforma. Base para el action item de la
reunión del 16 de junio: *diseñar la estructura de datos y la arquitectura de
automatización a partir del Excel*.

## Qué contiene el archivo

Hoja principal **"Leads per Areas"**: 4.286 leads (mar 2023 → jun 2026), 28
columnas. Hojas secundarias: `RCA_Dictionary` (24 entradas — ya portada 1:1 a
`src/lib/rca.ts`), `Templates` (plantillas de follow-up SMS/email), `In CC all
Areas` (conteos por área de la etapa Contractor Compliance), `All Leads`
(bandeja cruda de inbound) y varias hojas de pivotes/borradores.

### Hallazgos de calidad de datos

| Problema | Magnitud | Tratamiento en el normalizador |
|---|---|---|
| Fuentes con vocabulario inconsistente | 14 variantes: `Facebook (VIVO)`, `Facebook`, `Instagram`, `Gmail`, `Referral`/`Referal`/`Referral (Everdriven)`, `Craiglist` (sic), `Inbound Call`/`Inbound call`, `Web`, `Google Voice`; 303 en blanco | Mapa de sinónimos → vocabulario canónico |
| Duplicados | 300 filas repiten teléfono, 236 repiten email | Dedupe por teléfono E.164 y email lowercase; conservar la fila más completa y fusionar toques |
| Teléfonos sucios | 50 vacíos; longitudes 8–30 dígitos (lo normal: 10, EE. UU.) | Normalizar a E.164 (`+1XXXXXXXXXX`); si no valida, guardar crudo en `formData` y dejar `phone` nulo |
| Emails inválidos | 18 con formato roto | Igual: crudo a `formData`, campo nulo |
| Columna `Replied` contaminada | 93 valores: mezcla canal de respuesta ("Lead replied the SMS") con **datos del vehículo** ("Sedan", "Honda Civic") | Separar: respuestas → evento `replied`; vehículo → `formData.vehicle` |
| Columna `Year` | Es el **año del vehículo** (2013–2025), no del lead | → `formData.vehicleYear` |
| `Comments` como estado de facto | 532 valores distintos; el top 25 cubre ~80% y coincide con el nivel 3 del RCA | Mapear contra `RCA_TAXONOMY`; lo no mapeable → nota (`leadEvents.note`) |
| RCA con basura | 157 filas con `0` en los 3 niveles; 1.227 sin RCA | `0` = sin clasificar; queda nulo |
| Flags con casing inconsistente | `Yes`/`yes` en Contacted | Comparación case-insensitive |

### Estructura operativa que revela el Excel

- **Hasta 3 toques por lead** con agente y fecha: (`Contacted By` + `Contacted
  on`), (`Second outreach` + `Second Contact`), (`Third Outreach` + `Third
  Contact`). 4.134 primeros toques, 1.022 segundos, 121 terceros.
- Flags por lead: `Called`, `Voice Mail`, `Contacted`, `Text/email` (Yes/No).
- Dos geografías: `Area` (área operativa asignada, 61 valores incl. "Not
  Assigned") vs `Advertisement Area` (área del anuncio, 28 valores).
- Agentes: Pablo Rivas (~72%), Alirio Seekatz (~28%) + esporádicos.

## Mapeo al schema de la plataforma

Ya existe casi todo en `src/lib/db/schema.ts`:

| Excel | Plataforma |
|---|---|
| Created | `leads.createdAt` |
| Name / Phone / Email / City | `leads.name` / `phone` (E.164) / `email` / `geoCity` |
| Source | **GAP → nueva columna `leads.source`** (ver abajo) |
| Advertisement Area | `formData.advertisementArea` (largo plazo: match con `adsets.cityName`) |
| Area | `formData.operatingArea` |
| Toques 1/2/3 (agente+fecha) | `leadEvents` tipo `call`/`sms`/`email` con `userId` + `createdAt` retroactivo |
| Called / VM / Text-email | payload de esos `leadEvents` (`{manual:true, outcome}`) |
| Comments / Sub-comments | `leadEvents` tipo `note`, o RCA si mapea |
| RCA Lvl 1/2/3 | `leads.disqualL1/L2/L3` (taxonomía ya portada, validar con `isValidRcaPath`) |
| Replied (canal) | `leadEvents` con `outcome: "replied"` (dispara auto-avance a Contactado) |
| Replied (vehículo) + Year | `formData.vehicle` / `formData.vehicleYear` |

### Cambios de schema necesarios (pequeños)

1. **`leads.source`**: el enum `platform` actual (`meta`, `google_ads`, …) no
   modela fuentes manuales. Nueva columna `source` con vocabulario canónico:
   `meta` · `instagram` · `gmail` · `craigslist` · `web` · `referral` ·
   `inbound_call` · `other`. `platform` se mantiene para atribución de ads
   (los leads manuales usan `platform = 'meta'`? No — mejor hacer `platform`
   nullable o añadir valor `manual`; decidir en la implementación).
2. **Etapas canónicas del embudo** (decisión de Felipe/Juan Pablo): sembrar 4
   etapas — `Lead` → `Contactado` → `Contractor Compliance` → `Contratado` —
   usando la tabla `stages` existente (`kind` ya distingue won/lost). El
   reporte de embudo cuenta **desde el primer toque**, cerrando la brecha de
   reportes de la reunión.

### Inferencia de etapa al importar

```
RCA nivel 1/2/3 presente y término perdedor  → Lead perdido (stage kind=lost + disqual)
Comments ∈ {Profile created…, Completing A1s} → Contractor Compliance
Contacted = Yes o Replied con canal           → Contactado
resto                                         → Lead
```

(La hoja "In CC all Areas" solo tiene agregados por área, no filas por lead —
la señal fila-a-fila de CC son los Comments "Profile created…".)

## El normalizador (`scripts/import-legacy-leads.ts`)

Script one-shot idempotente (re-ejecutable sin duplicar, clave natural =
teléfono normalizado, si no email):

1. Parsear el xlsx (hoja "Leads per Areas").
2. Normalizar: source (mapa de sinónimos), teléfono E.164, email lowercase,
   fechas, flags case-insensitive.
3. Deduplicar y fusionar toques de filas repetidas.
4. Mapear Comments → RCA por diccionario; resto a notas.
5. Crear `leads` + `leadEvents` retroactivos (agente por nombre → `users`;
   requiere que Pablo/Alirio existan como usuarios, si no: `userId` nulo y el
   nombre en el payload).
6. Reporte final: importados, fusionados, sin teléfono, sin mapear.

Los leads importados quedan con `aiScore` nulo → `scorePendingLeads` los
puntúa en el siguiente sync nocturno automáticamente.

## Arquitectura de automatización (fase siguiente)

Con los datos dentro, las automatizaciones de la reunión son:

1. **Secuencias de follow-up**: tabla `followupRules` (workspace, trigger =
   etapa/outcome + días sin respuesta, acción = SMS/email con plantilla).
   Motor: el cron nocturno ya existe; añadir un paso que evalúe reglas y
   dispare `sendText` (RingCentral, ya integrado) / email (falta proveedor —
   Resend o similar). Las plantillas de la hoja `Templates` son la semilla.
2. **Scoring configurable**: ya existe (`qualificationCriteria` +
   `radiusBoost` geográfico — cubre el criterio distancia↔trabajo).
3. **Ingesta continua**: Meta ya sincroniza. Gmail/Web/Craigslist necesitan
   o (a) formulario/endpoint de captura manual en la app (rápido), o
   (b) integración Gmail (fase 2). El grueso histórico (89%) es Meta/IG.
4. **Contractor Compliance**: sin API por ahora — la etapa se mueve a mano;
   cuando Everdriven dé acceso, webhook → auto-avance de etapa.
