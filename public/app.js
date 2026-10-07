import { firebaseConfig } from "./firebase-config.js";

const app = document.getElementById("app");
const DEMO = firebaseConfig.apiKey.startsWith("TVOJ_");

// ---------- dátová vrstva ----------

let api;
if (DEMO) {
  document.getElementById("mode-badge").hidden = false;
  api = await import("./demo-data.js");
} else {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js");
  const fs = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
  const db = fs.getFirestore(initializeApp(firebaseConfig));

  api = {
    async getCities() {
      const snap = await fs.getDocs(fs.query(fs.collection(db, "cities"), fs.orderBy("name")));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async getCity(id) {
      const d = await fs.getDoc(fs.doc(db, "cities", id));
      return d.exists() ? { id: d.id, ...d.data() } : null;
    },
    async getEvents(cityId) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const q = fs.query(
        fs.collection(db, "events"),
        fs.where("cityId", "==", cityId),
        fs.where("start", ">=", fs.Timestamp.fromDate(today)),
        fs.orderBy("start"),
        fs.limit(300)
      );
      const snap = await fs.getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
  };
}

// ---------- pomocné ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\//.test(u || "") ? u : "");

function eventsWord(n) {
  if (n === 1) return "1 podujatie";
  if (n >= 2 && n <= 4) return `${n} podujatia`;
  return `${n} podujatí`;
}

function dayLabel(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  const full = d.toLocaleDateString("sk-SK", { weekday: "long", day: "numeric", month: "long" });
  if (diff <= 0) return `Dnes · ${full}`;
  if (diff === 1) return `Zajtra · ${full}`;
  return full;
}

const shortDate = (s) => new Date(s + "T12:00:00").toLocaleDateString("sk-SK", { day: "numeric", month: "numeric" });

function updatedLabel(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  return d ? `Aktualizované ${d.toLocaleString("sk-SK", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}` : "";
}

// ---------- obrazovky ----------

async function renderCities() {
  document.title = "Čo sa deje v meste";
  const cities = await api.getCities();
  app.innerHTML = `
    <h1>Čo sa deje v meste</h1>
    <p class="lead">Vyber mesto a pozri si nadchádzajúce koncerty, divadlá, festivaly a ďalšie podujatia.</p>
    <input class="search" type="search" placeholder="Hľadať mesto…" aria-label="Hľadať mesto">
    <ul class="cities"></ul>`;
  const list = app.querySelector(".cities");
  const draw = (filter = "") => {
    const f = filter.trim().toLocaleLowerCase("sk");
    const shown = cities.filter((c) => c.name.toLocaleLowerCase("sk").includes(f));
    list.innerHTML = shown.length
      ? shown.map((c) => `
        <li><a class="city" href="#/mesto/${encodeURIComponent(c.id)}">
          <div class="city-name">${esc(c.name)}</div>
          <div class="city-meta">${esc(c.region)}</div>
          <div class="city-count">${eventsWord(c.upcomingCount ?? 0)}</div>
        </a></li>`).join("")
      : `<li class="empty">Žiadne mesto sa nenašlo.</li>`;
  };
  draw();
  app.querySelector(".search").addEventListener("input", (e) => draw(e.target.value));
}

async function renderCity(cityId) {
  const [city, events] = await Promise.all([api.getCity(cityId), api.getEvents(cityId)]);
  if (!city) {
    app.innerHTML = `<a class="back" href="#/">← Všetky mestá</a><div class="empty">Mesto sa nenašlo.</div>`;
    return;
  }
  document.title = `Podujatia – ${city.name}`;
  const categories = [...new Set(events.map((e) => e.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "sk"));
  let active = "";

  app.innerHTML = `
    <a class="back" href="#/">← Všetky mestá</a>
    <h1>${esc(city.name)}</h1>
    <p class="lead">${eventsWord(events.length)} · ${esc(updatedLabel(city.lastUpdated))}</p>
    ${categories.length > 1 ? `<div class="chips" role="group" aria-label="Kategórie">
      <button class="chip" data-cat="" aria-pressed="true">Všetko</button>
      ${categories.map((c) => `<button class="chip" data-cat="${esc(c)}" aria-pressed="false">${esc(c)}</button>`).join("")}
    </div>` : ""}
    <div class="list"></div>`;

  const listEl = app.querySelector(".list");
  const draw = () => {
    const shown = events.filter((e) => !active || e.category === active);
    if (!shown.length) {
      listEl.innerHTML = `<div class="empty">Zatiaľ tu nie sú žiadne nadchádzajúce podujatia.</div>`;
      return;
    }
    const todayStr = new Date().toLocaleDateString("en-CA");
    const groups = new Map();
    for (const e of shown) {
      const key = e.startDate < todayStr ? todayStr : e.startDate;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    listEl.innerHTML = [...groups].map(([day, evs]) => `
      <h2 class="day">${esc(dayLabel(day))}</h2>
      <ul class="events">${evs.map(eventHtml).join("")}</ul>`).join("");
  };

  app.querySelectorAll(".chip").forEach((btn) =>
    btn.addEventListener("click", () => {
      active = btn.dataset.cat;
      app.querySelectorAll(".chip").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      draw();
    })
  );
  draw();
}

function eventHtml(e) {
  const url = safeUrl(e.url);
  const title = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title);
  const range = e.endDate && e.endDate !== e.startDate ? `do ${shortDate(e.endDate)}` : "";
  return `
    <li class="event">
      <div class="event-time">${esc(e.startTime || "celý deň")}${range ? `<small>${range}</small>` : ""}</div>
      <div>
        <p class="event-title">${title}</p>
        ${e.venue ? `<div class="event-venue">${esc(e.venue)}</div>` : ""}
        ${e.description ? `<p class="event-desc">${esc(e.description)}</p>` : ""}
        ${e.category ? `<span class="tag">${esc(e.category)}</span>` : ""}
      </div>
    </li>`;
}

// ---------- router ----------

async function route() {
  const m = location.hash.match(/^#\/mesto\/(.+)$/);
  try {
    if (m) await renderCity(decodeURIComponent(m[1]));
    else await renderCities();
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="empty">Nepodarilo sa načítať dáta. Skús to neskôr.</div>`;
  }
}

window.addEventListener("hashchange", route);
route();
