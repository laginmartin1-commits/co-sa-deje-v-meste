// AI bot: pre každé mesto nájde nadchádzajúce eventy a zapíše ich do Firestore.
//
// Zdroje:
//   - cities.json -> "sources": stránky konkrétneho mesta (mesto, divadlá, výstaviská, arény...)
//   - national-sources.json: celoslovenské stránky (predpredaje...), AI pri každom evente určí mesto
//
// Premenné prostredia:
//   GEMINI_API_KEY            (povinné) kľúč z https://aistudio.google.com
//   FIREBASE_SERVICE_ACCOUNT  JSON service accountu (alebo GOOGLE_APPLICATION_CREDENTIALS = cesta k súboru)
//   GEMINI_MODEL              voliteľné, predvolene gemini-flash-lite-latest (vyššie denné limity)
//
// Spustenie: node index.mjs [--dry-run] [--city=bratislava]

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const TZ = "Europe/Bratislava";
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
const API_KEY = process.env.GEMINI_API_KEY;
const DRY_RUN = process.argv.includes("--dry-run");
const ONLY_CITY = process.argv.find((a) => a.startsWith("--city="))?.split("=")[1];
// Free tier má limit ~10 požiadaviek/min, preto medzi volaniami čakáme.
const DELAY_MS = Number(process.env.GEMINI_DELAY_MS || 7000);
const MAX_PAGE_CHARS = 60000;
// Veľtrhy a festivaly sa plánujú dlho dopredu.
const HORIZON_DAYS = 365;

const CATEGORIES = ["hudba", "divadlo", "film", "šport", "výstava", "festival", "pre deti", "jedlo a trhy", "prednáška", "iné"];

if (!API_KEY) {
  console.error("Chýba GEMINI_API_KEY");
  process.exit(1);
}

const cities = JSON.parse(readFileSync(new URL("./cities.json", import.meta.url), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- dátumy ----------

function todayInTz() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()); // YYYY-MM-DD
}

// Prevedie lokálny dátum+čas v Bratislave na skutočný okamih (Date).
function localToDate(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = /^\d{1,2}:\d{2}$/.test(timeStr || "") ? timeStr.split(":").map(Number) : [0, 0];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(guess)).map((p) => [p.type, p.value])
  );
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asLocal - guess));
}

// ---------- sťahovanie stránok ----------

function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `${text} [${href}]`)
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "Accept-Language": "sk,en;q=0.8" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return htmlToText(await res.text()).slice(0, MAX_PAGE_CHARS);
}

// ---------- Gemini ----------

const EVENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    events: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          startDate: { type: "STRING", description: "YYYY-MM-DD" },
          startTime: { type: "STRING", description: "HH:MM alebo prázdne" },
          endDate: { type: "STRING", description: "YYYY-MM-DD alebo prázdne" },
          venue: { type: "STRING" },
          description: { type: "STRING", description: "1-2 vety po slovensky" },
          category: { type: "STRING", enum: CATEGORIES },
          url: { type: "STRING", description: "odkaz na detail eventu alebo prázdne" },
        },
        required: ["title", "startDate", "category"],
      },
    },
  },
  required: ["events"],
};

const NATIONAL_SCHEMA = structuredClone(EVENT_SCHEMA);
NATIONAL_SCHEMA.properties.events.items.properties.city = { type: "STRING", description: "mesto konania" };
NATIONAL_SCHEMA.properties.events.items.required.push("city");

// Pri preťažení hlavného modelu (503) skúsime záložný.
const MODELS = [...new Set([MODEL, process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-latest"])];

async function callGemini(body) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const model = MODELS[(attempt - 1) % MODELS.length];
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = res.status === 429 ? 30000 * attempt : 10000;
      console.warn(`  ${model}: ${res.status}, skúšam znova o ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${data.error?.message}`);
    return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  }
  throw new Error("Gemini: vyčerpané pokusy");
}

const rules = (today) => `Dnes je ${today}.
Pravidlá:
- Iba eventy so začiatkom dnes alebo neskôr (startDate >= ${today}) alebo viacdňové, ktoré ešte bežia; najviac ${HORIZON_DAYS} dní dopredu.
- Vytiahni VŠETKY eventy zo stránky (koncerty, divadlo, výstavy, veľtrhy, trhy, zápasy, festivaly...), nie len výber.
- Nevymýšľaj si. Ak nepoznáš presný dátum, event vynechaj.
- Ak chýba rok, doplň najbližší budúci.
- Názov ponechaj v pôvodnom znení, popis napíš stručne po slovensky.
- category vyber z: ${CATEGORIES.join(", ")}.`;

async function extract(prompt, schema) {
  const out = await callGemini({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: schema },
  });
  return JSON.parse(out).events || [];
}

const extractFromPage = (city, pageUrl, text, today) => extract(`${rules(today)}
- Iba eventy v meste ${city.name} (Slovensko) alebo jeho bezprostrednom okolí.
- Relatívne odkazy doplň na absolútne podľa adresy stránky: ${pageUrl}

Z nasledujúceho textu webovej stránky vytiahni zoznam eventov.
---
${text}`, EVENT_SCHEMA);

const extractNational = (pageUrl, text, today) => extract(`${rules(today)}
- Do "city" daj mesto konania tak, ako sa volá po slovensky (napr. "Banská Bystrica").
- Relatívne odkazy doplň na absolútne podľa adresy stránky: ${pageUrl}

Z nasledujúceho textu webovej stránky (podujatia z celého Slovenska) vytiahni zoznam eventov.
---
${text}`, NATIONAL_SCHEMA);

// ---------- normalizácia ----------

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const plain = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").trim();

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const clean = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

function normalize(raw, city, source, today) {
  const title = clean(raw.title, 200);
  if (!title || !isDate(raw.startDate)) return null;
  const endDate = isDate(raw.endDate) && raw.endDate >= raw.startDate ? raw.endDate : "";
  // viacdňové eventy, ktoré už bežia, necháme; skončené vyhodíme
  if ((endDate || raw.startDate) < today) return null;
  if (raw.startDate > addDays(today, HORIZON_DAYS)) return null;

  const startTime = /^\d{1,2}:\d{2}$/.test(raw.startTime || "") ? raw.startTime.padStart(5, "0") : "";
  let url = clean(raw.url, 500);
  if (!/^https?:\/\//.test(url)) url = "";

  const key = `${city.id}|${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()}|${raw.startDate}`;
  return {
    id: createHash("sha1").update(key).digest("hex").slice(0, 24),
    cityId: city.id,
    title,
    startDate: raw.startDate,
    startTime,
    endDate,
    // "start" slúži na triedenie; pre viacdňové už bežiace eventy použijeme dnešok, aby neprepadli filtrom
    start: localToDate(raw.startDate < today && endDate ? today : raw.startDate, startTime),
    venue: clean(raw.venue, 200),
    description: clean(raw.description, 600),
    category: CATEGORIES.includes(raw.category) ? raw.category : "iné",
    url,
    source,
  };
}

// ---------- Firestore ----------

async function initDb() {
  const { initializeApp, cert, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore, FieldValue, Timestamp } = await import("firebase-admin/firestore");
  const credential = process.env.FIREBASE_SERVICE_ACCOUNT
    ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    : applicationDefault();
  initializeApp({ credential });
  return { db: getFirestore(), FieldValue, Timestamp };
}

async function saveCity(ctx, city, events, today) {
  const { db, FieldValue, Timestamp } = ctx;
  const col = db.collection("events");

  let batch = db.batch();
  let n = 0;
  for (const ev of events) {
    const { id, ...data } = ev;
    batch.set(col.doc(id), { ...data, start: Timestamp.fromDate(data.start), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();

  // zmaž staré eventy (skončené)
  const old = await col.where("cityId", "==", city.id).where("start", "<", Timestamp.fromDate(localToDate(today, "00:00"))).limit(400).get();
  const del = db.batch();
  let removed = 0;
  for (const doc of old.docs) {
    const d = doc.data();
    if ((d.endDate || d.startDate) < today) { del.delete(doc.ref); removed++; }
  }
  if (removed) await del.commit();

  const upcoming = await col.where("cityId", "==", city.id).where("start", ">=", Timestamp.fromDate(localToDate(today, "00:00"))).count().get();
  await db.collection("cities").doc(city.id).set({
    name: city.name,
    region: city.region || "",
    upcomingCount: upcoming.data().count,
    lastUpdated: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { removed, upcoming: upcoming.data().count };
}

// ---------- hlavný beh ----------

async function readSource(url, extractor) {
  try {
    const text = await fetchPage(url);
    const evs = await extractor(text);
    console.log(`  ${url} -> ${evs.length}`);
    return evs;
  } catch (err) {
    console.warn(`  ${url} zlyhalo: ${err.message}`);
    return [];
  } finally {
    await sleep(DELAY_MS);
  }
}

function addEvents(bucket, raws, city, source, today) {
  for (const e of raws) {
    const ev = normalize(e, city, source, today);
    if (ev && !bucket.has(ev.id)) bucket.set(ev.id, ev);
  }
}

const today = todayInTz();
const selected = cities.filter((c) => !ONLY_CITY || c.id === ONLY_CITY);
const buckets = new Map(selected.map((c) => [c.id, new Map()]));

for (const city of selected) {
  console.log(`\n== ${city.name} ==`);
  for (const src of city.sources || []) {
    addEvents(buckets.get(city.id), await readSource(src, (t) => extractFromPage(city, src, t, today)), city, src, today);
  }
}

const national = JSON.parse(readFileSync(new URL("./national-sources.json", import.meta.url), "utf8"));
const byName = new Map(selected.map((c) => [plain(c.name), c]));
console.log("\n== Celoslovenské zdroje ==");
for (const src of national) {
  const evs = await readSource(src, (t) => extractNational(src, t, today));
  for (const e of evs) {
    const city = byName.get(plain(e.city));
    if (city) addEvents(buckets.get(city.id), [e], city, src, today);
  }
}

const ctx = DRY_RUN ? null : await initDb();
let failed = 0;
console.log("\n== Výsledok ==");
for (const city of selected) {
  const events = [...buckets.get(city.id).values()];
  if (DRY_RUN) {
    console.log(`${city.name}: ${events.length}`);
    for (const ev of events.slice(0, 5)) console.log(`   - ${ev.startDate} ${ev.startTime} ${ev.title} @ ${ev.venue}`);
    continue;
  }
  try {
    const r = await saveCity(ctx, city, events, today);
    console.log(`${city.name}: nájdených ${events.length}, v DB nadchádzajúcich ${r.upcoming}, zmazaných starých ${r.removed}`);
  } catch (err) {
    failed++;
    console.error(`${city.name}: zápis do DB zlyhal: ${err.message}`);
  }
}

process.exit(failed ? 1 : 0);
