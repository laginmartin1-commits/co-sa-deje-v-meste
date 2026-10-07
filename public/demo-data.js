// Ukážkové dáta pre demo režim (kým nie je vyplnený firebase-config.js).
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA");
};

const cities = [
  { id: "bratislava", name: "Bratislava", region: "Bratislavský kraj" },
  { id: "kosice", name: "Košice", region: "Košický kraj" },
  { id: "zilina", name: "Žilina", region: "Žilinský kraj" },
  { id: "nitra", name: "Nitra", region: "Nitriansky kraj" },
];

const events = [
  { cityId: "bratislava", title: "Jazzový večer na nábreží", startDate: day(0), startTime: "19:30", venue: "Eurovea, pavilón", description: "Živý jazz pod holým nebom s miestnymi kapelami.", category: "hudba", url: "https://example.com" },
  { cityId: "bratislava", title: "Farmársky trh", startDate: day(0), startTime: "08:00", venue: "Trhovisko Miletičova", description: "Sezónna zelenina, syry a pečivo od lokálnych výrobcov.", category: "jedlo a trhy" },
  { cityId: "bratislava", title: "Hamlet", startDate: day(1), startTime: "19:00", venue: "Slovenské národné divadlo", description: "Klasika v modernom spracovaní.", category: "divadlo" },
  { cityId: "bratislava", title: "Výstava súčasnej fotografie", startDate: day(-3), endDate: day(20), venue: "Kunsthalle", description: "Mladí autori zo strednej Európy.", category: "výstava" },
  { cityId: "bratislava", title: "Rozprávkové sobotné ráno", startDate: day(3), startTime: "10:00", venue: "Mestská knižnica", description: "Čítanie a tvorivá dielňa pre deti 4–8 rokov.", category: "pre deti" },
  { cityId: "kosice", title: "Hokej: HC Košice – HK Nitra", startDate: day(2), startTime: "17:30", venue: "Steel Aréna", description: "Zápas extraligy.", category: "šport" },
  { cityId: "kosice", title: "Biela noc – sprievodný program", startDate: day(5), startTime: "18:00", venue: "Hlavná ulica", description: "Svetelné inštalácie v uliciach mesta.", category: "festival" },
  { cityId: "zilina", title: "Filmový klub: dokumenty", startDate: day(1), startTime: "20:00", venue: "Stanica Žilina-Záriečie", description: "Projekcia s diskusiou.", category: "film" },
].map((e, i) => ({ id: String(i), ...e }));

export async function getCities() {
  return cities.map((c) => ({
    ...c,
    upcomingCount: events.filter((e) => e.cityId === c.id).length,
    lastUpdated: new Date(),
  })).sort((a, b) => a.name.localeCompare(b.name, "sk"));
}

export async function getCity(id) {
  return (await getCities()).find((c) => c.id === id) || null;
}

export async function getEvents(cityId) {
  const today = day(0);
  const key = (e) => (e.startDate < today ? today : e.startDate) + (e.startTime || "");
  return events.filter((e) => e.cityId === cityId).sort((a, b) => key(a).localeCompare(key(b)));
}
