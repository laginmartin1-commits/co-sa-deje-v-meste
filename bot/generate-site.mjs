// Vygeneruje statický web z dát vo Firestore do priečinka ../site
// (stránky miest, kategórií, víkendov, mesiacov a jednotlivých eventov + sitemap).
//
// Premenné prostredia:
//   FIREBASE_SERVICE_ACCOUNT / GOOGLE_APPLICATION_CREDENTIALS  ako pri index.mjs
//   SITE_URL   verejná adresa webu (predvolene Firebase adresa)
//
// Spustenie: node generate-site.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_NAME = "Kam v meste";
const SITE_URL = (process.env.SITE_URL || "https://co-sa-deje-v-meste-sk.web.app").replace(/\/$/, "");
const TZ = "Europe/Bratislava";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "site");
const cities = JSON.parse(readFileSync(join(here, "cities.json"), "utf8"));

// ---------- pomocné ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slugify = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "event";
const safeUrl = (u) => (/^https?:\/\//.test(u || "") ? u : "");

const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekday = (d) => new Date(d + "T12:00:00Z").getUTCDay(); // 0 = nedeľa
const fmt = (d, opts) => new Date(d + "T12:00:00Z").toLocaleDateString("sk-SK", { timeZone: "UTC", ...opts });

const MONTHS = ["januar", "februar", "marec", "april", "maj", "jun", "jul", "august", "september", "oktober", "november", "december"];
const MONTHS_NOM = ["január", "február", "marec", "apríl", "máj", "jún", "júl", "august", "september", "október", "november", "december"];

const CATEGORY_TITLES = {
  hudba: "Koncerty a hudba", divadlo: "Divadlo", film: "Film", "šport": "Šport", "výstava": "Výstavy a veľtrhy",
  festival: "Festivaly", "pre deti": "Pre deti", "jedlo a trhy": "Jedlo a trhy", "prednáška": "Prednášky", "iné": "Ostatné",
};

function eventsWord(n) {
  if (n === 1) return "1 podujatie";
  if (n >= 2 && n <= 4) return `${n} podujatia`;
  return `${n} podujatí`;
}

function dayLabel(d) {
  const full = fmt(d, { weekday: "long", day: "numeric", month: "long" });
  if (d <= todayStr) return `Dnes · ${full}`;
  if (d === addDays(todayStr, 1)) return `Zajtra · ${full}`;
  return full;
}

// Najbližší víkend (piatok - nedeľa); cez víkend ten aktuálny.
function weekendRange() {
  const wd = weekday(todayStr);
  const fri = wd === 0 ? addDays(todayStr, -2) : wd === 6 ? addDays(todayStr, -1) : addDays(todayStr, 5 - wd);
  return [fri, addDays(fri, 2)];
}

// Prekrýva sa event s intervalom [from, to]?
const overlaps = (e, from, to) => e.startDate <= to && (e.endDate || e.startDate) >= from;
// Dátum, pod ktorým event zobrazíme (bežiace viacdňové eventy pod dneškom).
const shownDate = (e) => (e.startDate < todayStr ? todayStr : e.startDate);

// ---------- dáta ----------

async function loadEvents() {
  const { initializeApp, cert, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const credential = process.env.FIREBASE_SERVICE_ACCOUNT ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) : applicationDefault();
  initializeApp({ credential });
  const snap = await getFirestore().collection("events").get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((e) => (e.endDate || e.startDate) >= todayStr)
    .sort((a, b) => (shownDate(a) + (a.startTime || "99")).localeCompare(shownDate(b) + (b.startTime || "99")));
}

// ---------- šablóny ----------

function layout({ title, description, path, body, jsonLd, breadcrumbs = [] }) {
  const url = SITE_URL + path;
  const crumbs = breadcrumbs.length
    ? `<nav class="crumbs" aria-label="Navigácia">${breadcrumbs.map(([label, href]) => (href ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`)).join(" / ")}</nav>`
    : "";
  return `<!doctype html>
<html lang="sk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:locale" content="sk_SK">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>` : ""}
</head>
<body>
<header class="top"><a href="/" class="brand"><span class="brand-mark" aria-hidden="true">●</span>${SITE_NAME}</a></header>
<main class="wrap">
${crumbs}
${body}
</main>
<footer class="wrap foot muted">
${SITE_NAME} zbiera podujatia z verejných stránok miest, divadiel, výstavísk a predpredajov. Aktualizované denne. Pred návštevou si over detaily u organizátora.
</footer>
</body>
</html>
`;
}

function eventItem(e, city) {
  const range = e.endDate && e.endDate !== e.startDate ? `do ${fmt(e.endDate, { day: "numeric", month: "numeric" })}` : "";
  return `<li class="event">
<div class="event-time">${esc(e.startTime || "celý deň")}${range ? `<small>${range}</small>` : ""}</div>
<div>
<p class="event-title"><a href="${e.path}">${esc(e.title)}</a></p>
${e.venue ? `<div class="event-venue">${esc(e.venue)}</div>` : ""}
${e.description ? `<p class="event-desc">${esc(e.description)}</p>` : ""}
${e.category ? `<a class="tag" href="/${city.id}/${slugify(e.category)}/">${esc(e.category)}</a>` : ""}
</div>
</li>`;
}

function eventList(events, city, emptyText = "Zatiaľ tu nie sú žiadne nadchádzajúce podujatia.") {
  if (!events.length) return `<div class="empty">${esc(emptyText)}</div>`;
  const groups = new Map();
  for (const e of events) {
    const k = shownDate(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  return [...groups].map(([d, evs]) => `<h2 class="day">${esc(dayLabel(d))}</h2>
<ul class="events">${evs.map((e) => eventItem(e, city)).join("\n")}</ul>`).join("\n");
}

function cityNav(city, cityEvents, active) {
  const cats = [...new Set(cityEvents.map((e) => e.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "sk"));
  const link = (href, label, key) => `<a class="chip" href="${href}"${key === active ? ' aria-current="page"' : ""}>${esc(label)}</a>`;
  return `<nav class="chips" aria-label="Filtre">
${link(`/${city.id}/`, "Všetko", "all")}
${link(`/${city.id}/tento-vikend/`, "Tento víkend", "weekend")}
${cats.map((c) => link(`/${city.id}/${slugify(c)}/`, c, c)).join("\n")}
</nav>`;
}

function eventJsonLd(e, city) {
  const offset = (d) => {
    // posun časovej zóny pre daný deň (+01:00 / +02:00)
    const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" }).formatToParts(new Date(d + "T12:00:00Z"));
    return (p.find((x) => x.type === "timeZoneName")?.value || "GMT+01:00").replace("GMT", "");
  };
  const ld = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: e.title,
    startDate: e.startTime ? `${e.startDate}T${e.startTime}:00${offset(e.startDate)}` : e.startDate,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: e.venue || city.name,
      address: { "@type": "PostalAddress", addressLocality: city.name, addressCountry: "SK" },
    },
    url: SITE_URL + e.path,
  };
  if (e.endDate) ld.endDate = e.endDate;
  if (e.description) ld.description = e.description;
  return ld;
}

// ---------- generovanie ----------

const pages = []; // { path, html }
const page = (path, html) => pages.push({ path, html });

function build(events) {
  const byCity = new Map(cities.map((c) => [c.id, []]));
  for (const e of events) byCity.get(e.cityId)?.push(e);

  // jedinečné adresy eventov
  for (const [cityId, evs] of byCity) {
    const used = new Set();
    for (const e of evs) {
      let slug = `${slugify(e.title)}-${e.startDate}`;
      for (let i = 2; used.has(slug); i++) slug = `${slugify(e.title)}-${e.startDate}-${i}`;
      used.add(slug);
      e.path = `/${cityId}/event/${slug}/`;
    }
  }

  const [wFrom, wTo] = weekendRange();

  // úvodná stránka
  const cityCards = cities.map((c) => {
    const n = byCity.get(c.id).length;
    const w = byCity.get(c.id).filter((e) => overlaps(e, wFrom, wTo)).length;
    return `<li><a class="city" href="/${c.id}/">
<div class="city-name">${esc(c.name)}</div>
<div class="city-meta">${esc(c.region)}</div>
<div class="city-count">${eventsWord(n)}</div>
${w ? `<div class="city-meta">${w} cez víkend</div>` : ""}
</a></li>`;
  }).join("\n");
  page("/", layout({
    title: `${SITE_NAME} – koncerty, divadlo, výstavy a akcie v slovenských mestách`,
    description: `Kam ísť v meste? Prehľad ${events.length} nadchádzajúcich podujatí v ${cities.length} slovenských mestách: koncerty, divadlá, festivaly, výstavy, trhy a šport. Aktualizované denne.`,
    path: "/",
    body: `<h1>Kam v meste</h1>
<p class="lead">Koncerty, divadlá, festivaly, výstavy, veľtrhy a ďalšie podujatia v slovenských mestách na jednom mieste. Aktualizované každý deň.</p>
<ul class="cities">${cityCards}</ul>
<script>if(location.hash.indexOf("#/mesto/")===0)location.replace("/"+location.hash.slice(8)+"/");</script>`,
  }));

  for (const city of cities) {
    const evs = byCity.get(city.id);
    const crumbsCity = [[SITE_NAME, "/"], [city.name, `/${city.id}/`]];

    // mesto
    page(`/${city.id}/`, layout({
      title: `Podujatia ${city.locative} – koncerty, divadlo, akcie | ${SITE_NAME}`,
      description: `Čo sa deje ${city.locative}? ${eventsWord(evs.length)}: koncerty, divadlo, výstavy, festivaly a šport. Program akcií ${city.locative} aktualizovaný denne.`,
      path: `/${city.id}/`,
      breadcrumbs: [[SITE_NAME, "/"], [city.name]],
      body: `<h1>Podujatia ${esc(city.locative)}</h1>
<p class="lead">${eventsWord(evs.length)} · aktualizované ${fmt(todayStr, { day: "numeric", month: "numeric", year: "numeric" })}</p>
${cityNav(city, evs, "all")}
${eventList(evs, city)}
${monthLinks(city, evs)}`,
    }));

    // tento víkend
    const wEvs = evs.filter((e) => overlaps(e, wFrom, wTo));
    const wLabel = `${fmt(wFrom, { day: "numeric", month: "numeric" })} – ${fmt(wTo, { day: "numeric", month: "numeric", year: "numeric" })}`;
    page(`/${city.id}/tento-vikend/`, layout({
      title: `Čo robiť ${city.locative} tento víkend (${wLabel}) | ${SITE_NAME}`,
      description: `Kam ísť ${city.locative} cez víkend ${wLabel}? ${eventsWord(wEvs.length)}: koncerty, divadlo, akcie pre deti, trhy a ďalšie.`,
      path: `/${city.id}/tento-vikend/`,
      breadcrumbs: [...crumbsCity, ["Tento víkend"]],
      body: `<h1>Tento víkend ${esc(city.locative)}</h1>
<p class="lead">${wLabel} · ${eventsWord(wEvs.length)}</p>
${cityNav(city, evs, "weekend")}
${eventList(wEvs.map((e) => ({ ...e, startDate: e.startDate < wFrom ? wFrom : e.startDate })), city, "Na tento víkend zatiaľ nemáme žiadne podujatia.")}`,
    }));

    // kategórie
    const cats = [...new Set(evs.map((e) => e.category).filter(Boolean))];
    for (const cat of cats) {
      const cEvs = evs.filter((e) => e.category === cat);
      const t = CATEGORY_TITLES[cat] || cat;
      page(`/${city.id}/${slugify(cat)}/`, layout({
        title: `${t} ${city.locative} – program | ${SITE_NAME}`,
        description: `${t} ${city.locative}: ${eventsWord(cEvs.length)} s dátumom, miestom a odkazom na lístky. Aktualizované denne.`,
        path: `/${city.id}/${slugify(cat)}/`,
        breadcrumbs: [...crumbsCity, [t]],
        body: `<h1>${esc(t)} ${esc(city.locative)}</h1>
<p class="lead">${eventsWord(cEvs.length)}</p>
${cityNav(city, evs, cat)}
${eventList(cEvs, city)}`,
      }));
    }

    // mesiace
    for (const [key, mEvs] of byMonth(evs)) {
      const [y, m] = key.split("-").map(Number);
      const label = `${MONTHS_NOM[m - 1]} ${y}`;
      page(`/${city.id}/${MONTHS[m - 1]}-${y}/`, layout({
        title: `Akcie ${city.locative} – ${label} | ${SITE_NAME}`,
        description: `Program podujatí ${city.locative} na ${label}: ${eventsWord(mEvs.length)} – koncerty, divadlo, výstavy, festivaly a šport.`,
        path: `/${city.id}/${MONTHS[m - 1]}-${y}/`,
        breadcrumbs: [...crumbsCity, [label]],
        body: `<h1>Akcie ${esc(city.locative)} – ${esc(label)}</h1>
<p class="lead">${eventsWord(mEvs.length)}</p>
${cityNav(city, evs, null)}
${eventList(mEvs.map((e) => ({ ...e, startDate: e.startDate < `${key}-01` ? `${key}-01` : e.startDate })), city)}`,
      }));
    }

    // jednotlivé eventy
    for (const e of evs) {
      const when = e.endDate && e.endDate !== e.startDate
        ? `${fmt(e.startDate, { day: "numeric", month: "long" })} – ${fmt(e.endDate, { day: "numeric", month: "long", year: "numeric" })}`
        : fmt(e.startDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      const url = safeUrl(e.url) || safeUrl(e.source);
      const related = evs.filter((x) => x !== e && overlaps(x, e.startDate, addDays(e.startDate, 7))).slice(0, 6);
      page(e.path, layout({
        title: `${e.title} – ${city.name}, ${fmt(e.startDate, { day: "numeric", month: "numeric", year: "numeric" })} | ${SITE_NAME}`,
        description: `${e.title}: ${when}${e.startTime ? ` o ${e.startTime}` : ""}${e.venue ? `, ${e.venue}` : ""}, ${city.name}. ${e.description || ""}`.slice(0, 300),
        path: e.path,
        jsonLd: eventJsonLd(e, city),
        breadcrumbs: [...crumbsCity, [e.title]],
        body: `<article class="detail">
<h1>${esc(e.title)}</h1>
<dl class="facts">
<dt>Kedy</dt><dd>${esc(when)}${e.startTime ? ` o ${esc(e.startTime)}` : ""}</dd>
<dt>Kde</dt><dd>${esc(e.venue || city.name)}${e.venue ? `, ${esc(city.name)}` : ""}</dd>
${e.category ? `<dt>Kategória</dt><dd><a href="/${city.id}/${slugify(e.category)}/">${esc(e.category)}</a></dd>` : ""}
</dl>
${e.description ? `<p>${esc(e.description)}</p>` : ""}
${url ? `<p><a class="button" href="${esc(url)}" target="_blank" rel="noopener">Viac informácií a lístky</a></p>` : ""}
<p class="muted small">Zdroj: ${esc((safeUrl(e.source) || "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0] || "verejné stránky")}</p>
</article>
${related.length ? `<h2 class="day">Ďalšie akcie ${esc(city.locative)} v tých dňoch</h2><ul class="events">${related.map((x) => eventItem(x, city)).join("\n")}</ul>` : ""}`,
      }));
    }
  }

  page("/404.html", layout({
    title: `Stránka sa nenašla | ${SITE_NAME}`,
    description: "Táto stránka neexistuje alebo podujatie už skončilo.",
    path: "/404.html",
    body: `<h1>Stránka sa nenašla</h1><p class="lead">Podujatie už možno skončilo. <a href="/">Pozri si aktuálne akcie</a>.</p>`,
  }));
}

function byMonth(evs) {
  const map = new Map();
  for (const e of evs) {
    // viacdňový event patrí do každého mesiaca, ktorým prechádza
    let d = shownDate(e).slice(0, 7);
    const last = (e.endDate || e.startDate).slice(0, 7);
    while (d <= last) {
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(e);
      const [y, m] = d.split("-").map(Number);
      d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    }
  }
  return [...map].sort(([a], [b]) => a.localeCompare(b));
}

function monthLinks(city, evs) {
  const months = byMonth(evs);
  if (months.length < 2) return "";
  return `<h2 class="day">Podľa mesiaca</h2><nav class="chips">${months.map(([key, m]) => {
    const [y, mo] = key.split("-").map(Number);
    return `<a class="chip" href="/${city.id}/${MONTHS[mo - 1]}-${y}/">${MONTHS_NOM[mo - 1]} ${y} (${m.length})</a>`;
  }).join("\n")}</nav>`;
}

function write() {
  rmSync(OUT, { recursive: true, force: true });
  for (const { path, html } of pages) {
    const file = path.endsWith(".html") ? join(OUT, path) : join(OUT, path, "index.html");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
  }
  copyFileSync(join(here, "site-assets", "style.css"), join(OUT, "style.css"));
  const urls = pages.filter((p) => !p.path.endsWith(".html"));
  writeFileSync(join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((p) => `<url><loc>${SITE_URL}${p.path}</loc><lastmod>${todayStr}</lastmod></url>`).join("\n")}
</urlset>
`);
  writeFileSync(join(OUT, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
}

const events = await loadEvents();
build(events);
write();
console.log(`Vygenerovaných ${pages.length} stránok z ${events.length} eventov do ${OUT}`);
process.exit(0);
