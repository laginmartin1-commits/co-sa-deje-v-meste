// Vygeneruje statický web z dát vo Firestore do priečinka ../site
// (stránky miest, kategórií, víkendov, mesiacov a jednotlivých eventov + sitemap),
// v slovenčine (/) a angličtine (/en/).
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
const SITE_URL = (process.env.SITE_URL || "https://kamvmeste.web.app").replace(/\/$/, "");
const TZ = "Europe/Bratislava";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "site");
const cities = JSON.parse(readFileSync(join(here, "cities.json"), "utf8"));

// Ďalšie jazyky cez Google Prekladač (bez skriptov a cookies na našej stránke).
const MACHINE_LANGS = [["de", "Deutsch"], ["hu", "Magyar"], ["pl", "Polski"], ["cs", "Čeština"], ["uk", "Українська"], ["fr", "Français"], ["it", "Italiano"], ["es", "Español"]];

// ---------- texty ----------

const SK = {
  code: "sk", locale: "sk-SK", prefix: "", ogLocale: "sk_SK",
  months: ["januar", "februar", "marec", "april", "maj", "jun", "jul", "august", "september", "oktober", "november", "december"],
  monthsNom: ["január", "február", "marec", "apríl", "máj", "jún", "júl", "august", "september", "október", "november", "december"],
  weekendSlug: "tento-vikend",
  cat: {
    hudba: ["hudba", "Koncerty a hudba"], divadlo: ["divadlo", "Divadlo"], film: ["film", "Film"], "šport": ["sport", "Šport"],
    "výstava": ["vystava", "Výstavy a veľtrhy"], festival: ["festival", "Festivaly"], "pre deti": ["pre-deti", "Pre deti"],
    "jedlo a trhy": ["jedlo-a-trhy", "Jedlo a trhy"], "prednáška": ["prednaska", "Prednášky"], "iné": ["ine", "Ostatné"],
  },
  catLabel: (c) => c,
  count(n) { return n === 1 ? "1 podujatie" : n >= 2 && n <= 4 ? `${n} podujatia` : `${n} podujatí`; },
  today: "Dnes", tomorrow: "Zajtra", allDay: "celý deň", until: "do",
  all: "Všetko", thisWeekend: "Tento víkend", byMonth: "Podľa mesiaca", filters: "Filtre", nav: "Navigácia",
  weekendCount: (n) => `${n} cez víkend`,
  updated: (d) => `aktualizované ${d}`,
  empty: "Zatiaľ tu nie sú žiadne nadchádzajúce podujatia.",
  emptyWeekend: "Na tento víkend zatiaľ nemáme žiadne podujatia.",
  when: "Kedy", where: "Kde", category: "Kategória", at: "o", more: "Viac informácií a lístky", source: "Zdroj", publicPages: "verejné stránky",
  related: (loc) => `Ďalšie akcie ${loc} v tých dňoch`,
  otherLangs: "Ďalšie jazyky", machine: "strojový preklad Google",
  footer: `${SITE_NAME} zbiera podujatia z verejných stránok miest, divadiel, výstavísk a predpredajov. Aktualizované denne. Pred návštevou si over detaily u organizátora.`,
  home: {
    title: `${SITE_NAME} – koncerty, divadlo, výstavy a akcie v slovenských mestách`,
    desc: (n, c) => `Kam ísť v meste? Prehľad ${n} nadchádzajúcich podujatí v ${c} slovenských mestách: koncerty, divadlá, festivaly, výstavy, trhy a šport. Aktualizované denne.`,
    h1: "Kam v meste",
    lead: "Koncerty, divadlá, festivaly, výstavy, veľtrhy a ďalšie podujatia v slovenských mestách na jednom mieste. Aktualizované každý deň.",
  },
  city: {
    title: (c) => `Podujatia ${c.locative} – koncerty, divadlo, akcie | ${SITE_NAME}`,
    desc: (c, n) => `Čo sa deje ${c.locative}? ${n}: koncerty, divadlo, výstavy, festivaly a šport. Program akcií ${c.locative} aktualizovaný denne.`,
    h1: (c) => `Podujatia ${c.locative}`,
  },
  weekend: {
    title: (c, l) => `Čo robiť ${c.locative} tento víkend (${l}) | ${SITE_NAME}`,
    desc: (c, l, n) => `Kam ísť ${c.locative} cez víkend ${l}? ${n}: koncerty, divadlo, akcie pre deti, trhy a ďalšie.`,
    h1: (c) => `Tento víkend ${c.locative}`,
  },
  catPage: {
    title: (t, c) => `${t} ${c.locative} – program | ${SITE_NAME}`,
    desc: (t, c, n) => `${t} ${c.locative}: ${n} s dátumom, miestom a odkazom na lístky. Aktualizované denne.`,
    h1: (t, c) => `${t} ${c.locative}`,
  },
  month: {
    title: (c, l) => `Akcie ${c.locative} – ${l} | ${SITE_NAME}`,
    desc: (c, l, n) => `Program podujatí ${c.locative} na ${l}: ${n} – koncerty, divadlo, výstavy, festivaly a šport.`,
    h1: (c, l) => `Akcie ${c.locative} – ${l}`,
  },
  notFound: { title: `Stránka sa nenašla | ${SITE_NAME}`, desc: "Táto stránka neexistuje alebo podujatie už skončilo.", h1: "Stránka sa nenašla", lead: 'Podujatie už možno skončilo. <a href="/">Pozri si aktuálne akcie</a>.' },
  locative: (c) => c.locative,
  description: (e) => e.description,
};

const EN = {
  code: "en", locale: "en-GB", prefix: "/en", ogLocale: "en_GB",
  months: ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"],
  monthsNom: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  weekendSlug: "this-weekend",
  cat: {
    hudba: ["music", "Concerts & music"], divadlo: ["theatre", "Theatre"], film: ["film", "Film"], "šport": ["sport", "Sport"],
    "výstava": ["exhibitions", "Exhibitions & fairs"], festival: ["festivals", "Festivals"], "pre deti": ["kids", "For kids"],
    "jedlo a trhy": ["food-and-markets", "Food & markets"], "prednáška": ["talks", "Talks & workshops"], "iné": ["other", "Other"],
  },
  catLabel: (c) => (EN.cat[c] || [, c])[1],
  count(n) { return n === 1 ? "1 event" : `${n} events`; },
  today: "Today", tomorrow: "Tomorrow", allDay: "all day", until: "until",
  all: "All", thisWeekend: "This weekend", byMonth: "By month", filters: "Filters", nav: "Breadcrumbs",
  weekendCount: (n) => `${n} this weekend`,
  updated: (d) => `updated ${d}`,
  empty: "No upcoming events yet.",
  emptyWeekend: "No events for this weekend yet.",
  when: "When", where: "Where", category: "Category", at: "at", more: "More info & tickets", source: "Source", publicPages: "public websites",
  related: (loc) => `More events ${loc} around the same time`,
  otherLangs: "Other languages", machine: "Google machine translation",
  footer: `${SITE_NAME} collects events from public websites of cities, theatres, exhibition centres and ticket sellers. Updated daily. Please check details with the organiser before you go.`,
  home: {
    title: `${SITE_NAME} – concerts, theatre, exhibitions and events in Slovak cities`,
    desc: (n, c) => `What's on in Slovakia? ${n} upcoming events in ${c} Slovak cities: concerts, theatre, festivals, exhibitions, markets and sport. Updated daily.`,
    h1: "What's on in Slovak cities",
    lead: "Concerts, theatre, festivals, exhibitions, trade fairs and more in Slovak cities, all in one place. Updated every day.",
  },
  city: {
    title: (c) => `Events in ${c.name} – concerts, theatre, what's on | ${SITE_NAME}`,
    desc: (c, n) => `What's on in ${c.name}? ${n}: concerts, theatre, exhibitions, festivals and sport. Updated daily.`,
    h1: (c) => `What's on in ${c.name}`,
  },
  weekend: {
    title: (c, l) => `Things to do in ${c.name} this weekend (${l}) | ${SITE_NAME}`,
    desc: (c, l, n) => `What to do in ${c.name} this weekend, ${l}? ${n}: concerts, theatre, family events, markets and more.`,
    h1: (c) => `This weekend in ${c.name}`,
  },
  catPage: {
    title: (t, c) => `${t} in ${c.name} – programme | ${SITE_NAME}`,
    desc: (t, c, n) => `${t} in ${c.name}: ${n} with date, venue and ticket link. Updated daily.`,
    h1: (t, c) => `${t} in ${c.name}`,
  },
  month: {
    title: (c, l) => `Events in ${c.name} – ${l} | ${SITE_NAME}`,
    desc: (c, l, n) => `What's on in ${c.name} in ${l}: ${n} – concerts, theatre, exhibitions, festivals and sport.`,
    h1: (c, l) => `Events in ${c.name} – ${l}`,
  },
  notFound: { title: `Page not found | ${SITE_NAME}`, desc: "This page does not exist or the event has ended.", h1: "Page not found", lead: 'The event may have ended. <a href="/en/">See current events</a>.' },
  locative: (c) => `in ${c.name}`,
  description: (e) => e.descriptionEn || e.description,
};

// ---------- pomocné ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slugify = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "event";
const safeUrl = (u) => (/^https?:\/\//.test(u || "") ? u : "");

const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekday = (d) => new Date(d + "T12:00:00Z").getUTCDay(); // 0 = nedeľa

const catSlug = (L, c) => (L.cat[c] || [slugify(c)])[0];
const catTitle = (L, c) => (L.cat[c] || [, c])[1];

function weekendRange() {
  const wd = weekday(todayStr);
  const fri = wd === 0 ? addDays(todayStr, -2) : wd === 6 ? addDays(todayStr, -1) : addDays(todayStr, 5 - wd);
  return [fri, addDays(fri, 2)];
}
const overlaps = (e, from, to) => e.startDate <= to && (e.endDate || e.startDate) >= from;
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

function byMonth(evs) {
  const map = new Map();
  for (const e of evs) {
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

// ---------- generovanie jedného jazyka ----------

const pages = []; // { path, html }

function buildLang(L, events, byCity) {
  const P = L.prefix;
  const other = L === SK ? EN : SK;
  const fmt = (d, opts) => new Date(d + "T12:00:00Z").toLocaleDateString(L.locale, { timeZone: "UTC", ...opts });
  const dayLabel = (d) => {
    const full = fmt(d, { weekday: "long", day: "numeric", month: "long" });
    if (d <= todayStr) return `${L.today} · ${full}`;
    if (d === addDays(todayStr, 1)) return `${L.tomorrow} · ${full}`;
    return full;
  };
  const evPath = (e, lang = L) => `${lang.prefix}/${e.cityId}/event/${e.slug}/`;

  // Každá stránka vie svoj náprotivok v druhom jazyku (pre prepínač a hreflang).
  function page(path, altPath, opts) {
    pages.push({ path, html: layout({ ...opts, path, altPath }) });
  }

  function layout({ title, description, path, altPath, body, jsonLd, breadcrumbs = [] }) {
    const url = SITE_URL + path;
    const skPath = L === SK ? path : altPath;
    const enPath = L === EN ? path : altPath;
    const crumbs = breadcrumbs.length
      ? `<nav class="crumbs" aria-label="${L.nav}">${breadcrumbs.map(([label, href]) => (href ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`)).join(" / ")}</nav>`
      : "";
    const machine = MACHINE_LANGS.map(([code, name]) =>
      `<a href="https://translate.google.com/translate?sl=sk&amp;tl=${code}&amp;u=${encodeURIComponent(SITE_URL + skPath)}" rel="nofollow noopener" target="_blank" lang="${code}">${name}</a>`).join("");
    return `<!doctype html>
<html lang="${L.code}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
${skPath && enPath ? `<link rel="alternate" hreflang="sk" href="${esc(SITE_URL + skPath)}">
<link rel="alternate" hreflang="en" href="${esc(SITE_URL + enPath)}">
<link rel="alternate" hreflang="x-default" href="${esc(SITE_URL + skPath)}">` : ""}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:locale" content="${L.ogLocale}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>` : ""}
</head>
<body>
<header class="top">
<a href="${P}/" class="brand"><span class="brand-mark" aria-hidden="true">●</span>${SITE_NAME}</a>
<div class="lang">
${altPath ? `<a class="lang-btn" href="${altPath}" hreflang="${other.code}" lang="${other.code}" title="${other === EN ? "English" : "Slovensky"}">${other.code.toUpperCase()}</a>` : ""}
<details class="lang-more"><summary aria-label="${L.otherLangs}">🌐</summary><div class="lang-menu"><span class="muted small">${L.otherLangs} (${L.machine})</span>${machine}</div></details>
</div>
</header>
<main class="wrap">
${crumbs}
${body}
</main>
<footer class="wrap foot muted">${esc(L.footer)}</footer>
</body>
</html>
`;
  }

  function eventItem(e, city) {
    const range = e.endDate && e.endDate !== e.startDate ? `${L.until} ${fmt(e.endDate, { day: "numeric", month: "numeric" })}` : "";
    const desc = L.description(e);
    return `<li class="event">
<div class="event-time">${esc(e.startTime || L.allDay)}${range ? `<small>${range}</small>` : ""}</div>
<div>
<p class="event-title"><a href="${evPath(e)}">${esc(e.title)}</a></p>
${e.venue ? `<div class="event-venue">${esc(e.venue)}</div>` : ""}
${desc ? `<p class="event-desc">${esc(desc)}</p>` : ""}
${e.category ? `<a class="tag" href="${P}/${city.id}/${catSlug(L, e.category)}/">${esc(L.catLabel(e.category))}</a>` : ""}
</div>
</li>`;
  }

  function eventList(evs, city, emptyText = L.empty) {
    if (!evs.length) return `<div class="empty">${esc(emptyText)}</div>`;
    const groups = new Map();
    for (const e of evs) {
      const k = shownDate(e);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    return [...groups].map(([d, list]) => `<h2 class="day">${esc(dayLabel(d))}</h2>
<ul class="events">${list.map((e) => eventItem(e, city)).join("\n")}</ul>`).join("\n");
  }

  function cityNav(city, cityEvents, active) {
    const cats = [...new Set(cityEvents.map((e) => e.category).filter(Boolean))].sort((a, b) => L.catLabel(a).localeCompare(L.catLabel(b), L.locale));
    const link = (href, label, key) => `<a class="chip" href="${href}"${key === active ? ' aria-current="page"' : ""}>${esc(label)}</a>`;
    return `<nav class="chips" aria-label="${L.filters}">
${link(`${P}/${city.id}/`, L.all, "all")}
${link(`${P}/${city.id}/${L.weekendSlug}/`, L.thisWeekend, "weekend")}
${cats.map((c) => link(`${P}/${city.id}/${catSlug(L, c)}/`, L.catLabel(c), c)).join("\n")}
</nav>`;
  }

  function monthLinks(city, evs) {
    const months = byMonth(evs);
    if (months.length < 2) return "";
    return `<h2 class="day">${L.byMonth}</h2><nav class="chips">${months.map(([key, m]) => {
      const [y, mo] = key.split("-").map(Number);
      return `<a class="chip" href="${P}/${city.id}/${L.months[mo - 1]}-${y}/">${L.monthsNom[mo - 1]} ${y} (${m.length})</a>`;
    }).join("\n")}</nav>`;
  }

  function eventJsonLd(e, city) {
    const offset = (d) => {
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
      url: SITE_URL + evPath(e),
      inLanguage: L.code,
    };
    if (e.endDate) ld.endDate = e.endDate;
    const desc = L.description(e);
    if (desc) ld.description = desc;
    return ld;
  }

  const [wFrom, wTo] = weekendRange();
  const dateShort = (d) => fmt(d, { day: "numeric", month: "numeric" });
  const dateFull = (d) => fmt(d, { day: "numeric", month: "numeric", year: "numeric" });

  // úvodná stránka
  // mestá bez eventov na úvodnej stránke nezobrazujeme
  const cityCards = cities.filter((c) => byCity.get(c.id).length).map((c) => {
    const n = byCity.get(c.id).length;
    const w = byCity.get(c.id).filter((e) => overlaps(e, wFrom, wTo)).length;
    return `<li><a class="city" href="${P}/${c.id}/">
<div class="city-name">${esc(c.name)}</div>
<div class="city-meta">${esc(c.region)}</div>
<div class="city-count">${L.count(n)}</div>
${w ? `<div class="city-meta">${L.weekendCount(w)}</div>` : ""}
</a></li>`;
  }).join("\n");
  page(`${P}/`, `${other.prefix}/`, {
    title: L.home.title,
    description: L.home.desc(events.length, cities.length),
    body: `<h1>${esc(L.home.h1)}</h1>
<p class="lead">${esc(L.home.lead)}</p>
<ul class="cities">${cityCards}</ul>
${L === SK ? `<script>if(location.hash.indexOf("#/mesto/")===0)location.replace("/"+location.hash.slice(8)+"/");</script>` : ""}`,
  });

  for (const city of cities) {
    const evs = byCity.get(city.id);
    const base = `${P}/${city.id}`;
    const obase = `${other.prefix}/${city.id}`;
    const crumbsCity = [[SITE_NAME, `${P}/`], [city.name, `${base}/`]];

    page(`${base}/`, `${obase}/`, {
      title: L.city.title(city),
      description: L.city.desc(city, L.count(evs.length)),
      breadcrumbs: [[SITE_NAME, `${P}/`], [city.name]],
      body: `<h1>${esc(L.city.h1(city))}</h1>
<p class="lead">${L.count(evs.length)} · ${L.updated(dateFull(todayStr))}</p>
${cityNav(city, evs, "all")}
${eventList(evs, city)}
${monthLinks(city, evs)}`,
    });

    const wEvs = evs.filter((e) => overlaps(e, wFrom, wTo));
    const wLabel = `${dateShort(wFrom)} – ${dateFull(wTo)}`;
    page(`${base}/${L.weekendSlug}/`, `${obase}/${other.weekendSlug}/`, {
      title: L.weekend.title(city, wLabel),
      description: L.weekend.desc(city, wLabel, L.count(wEvs.length)),
      breadcrumbs: [...crumbsCity, [L.thisWeekend]],
      body: `<h1>${esc(L.weekend.h1(city))}</h1>
<p class="lead">${wLabel} · ${L.count(wEvs.length)}</p>
${cityNav(city, evs, "weekend")}
${eventList(wEvs.map((e) => ({ ...e, startDate: e.startDate < wFrom ? wFrom : e.startDate })), city, L.emptyWeekend)}`,
    });

    for (const cat of new Set(evs.map((e) => e.category).filter(Boolean))) {
      const cEvs = evs.filter((e) => e.category === cat);
      const t = catTitle(L, cat);
      page(`${base}/${catSlug(L, cat)}/`, `${obase}/${catSlug(other, cat)}/`, {
        title: L.catPage.title(t, city),
        description: L.catPage.desc(t, city, L.count(cEvs.length)),
        breadcrumbs: [...crumbsCity, [t]],
        body: `<h1>${esc(L.catPage.h1(t, city))}</h1>
<p class="lead">${L.count(cEvs.length)}</p>
${cityNav(city, evs, cat)}
${eventList(cEvs, city)}`,
      });
    }

    for (const [key, mEvs] of byMonth(evs)) {
      const [y, m] = key.split("-").map(Number);
      const label = `${L.monthsNom[m - 1]} ${y}`;
      page(`${base}/${L.months[m - 1]}-${y}/`, `${obase}/${other.months[m - 1]}-${y}/`, {
        title: L.month.title(city, label),
        description: L.month.desc(city, label, L.count(mEvs.length)),
        breadcrumbs: [...crumbsCity, [label]],
        body: `<h1>${esc(L.month.h1(city, label))}</h1>
<p class="lead">${L.count(mEvs.length)}</p>
${cityNav(city, evs, null)}
${eventList(mEvs.map((e) => ({ ...e, startDate: e.startDate < `${key}-01` ? `${key}-01` : e.startDate })), city)}`,
      });
    }

    for (const e of evs) {
      const when = e.endDate && e.endDate !== e.startDate
        ? `${fmt(e.startDate, { day: "numeric", month: "long" })} – ${fmt(e.endDate, { day: "numeric", month: "long", year: "numeric" })}`
        : fmt(e.startDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      const url = safeUrl(e.url) || safeUrl(e.source);
      const desc = L.description(e);
      const related = evs.filter((x) => x !== e && overlaps(x, e.startDate, addDays(e.startDate, 7))).slice(0, 6);
      page(evPath(e), evPath(e, other), {
        title: `${e.title} – ${city.name}, ${dateFull(e.startDate)} | ${SITE_NAME}`,
        description: `${e.title}: ${when}${e.startTime ? ` ${L.at} ${e.startTime}` : ""}${e.venue ? `, ${e.venue}` : ""}, ${city.name}. ${desc || ""}`.slice(0, 300),
        jsonLd: eventJsonLd(e, city),
        breadcrumbs: [...crumbsCity, [e.title]],
        body: `<article class="detail">
<h1>${esc(e.title)}</h1>
<dl class="facts">
<dt>${L.when}</dt><dd>${esc(when)}${e.startTime ? ` ${L.at} ${esc(e.startTime)}` : ""}</dd>
<dt>${L.where}</dt><dd>${esc(e.venue || city.name)}${e.venue ? `, ${esc(city.name)}` : ""}</dd>
${e.category ? `<dt>${L.category}</dt><dd><a href="${base}/${catSlug(L, e.category)}/">${esc(L.catLabel(e.category))}</a></dd>` : ""}
</dl>
${desc ? `<p>${esc(desc)}</p>` : ""}
${url ? `<p><a class="button" href="${esc(url)}" target="_blank" rel="noopener">${L.more}</a></p>` : ""}
<p class="muted small">${L.source}: ${esc((safeUrl(e.source) || "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0] || L.publicPages)}</p>
</article>
${related.length ? `<h2 class="day">${esc(L.related(L.locative(city)))}</h2><ul class="events">${related.map((x) => eventItem(x, city)).join("\n")}</ul>` : ""}`,
      });
    }
  }

  page(L === SK ? "/404.html" : "/en/404.html", null, {
    title: L.notFound.title,
    description: L.notFound.desc,
    body: `<h1>${esc(L.notFound.h1)}</h1><p class="lead">${L.notFound.lead}</p>`,
  });
}

function build(events) {
  const byCity = new Map(cities.map((c) => [c.id, []]));
  for (const e of events) byCity.get(e.cityId)?.push(e);

  // jedinečné adresy eventov (rovnaké v oboch jazykoch)
  for (const evs of byCity.values()) {
    const used = new Set();
    for (const e of evs) {
      let slug = `${slugify(e.title)}-${e.startDate}`;
      for (let i = 2; used.has(slug); i++) slug = `${slugify(e.title)}-${e.startDate}-${i}`;
      used.add(slug);
      e.slug = slug;
    }
  }

  buildLang(SK, events, byCity);
  buildLang(EN, events, byCity);
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
console.log(`Vygenerovaných ${pages.length} stránok (SK + EN) z ${events.length} eventov do ${OUT}`);
process.exit(0);
