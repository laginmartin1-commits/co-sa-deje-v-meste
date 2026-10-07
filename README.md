# Čo sa deje v meste

Web so zoznamom miest a nadchádzajúcich eventov. Eventy zbiera AI bot z verejných stránok raz denne.

## Ako to funguje (celé zadarmo)

```
GitHub Actions (každý deň 6:00)
   └─ bot/index.mjs
        ├─ stiahne stránky s podujatiami (bot/cities.json, bot/national-sources.json)
        ├─ Gemini API (free tier) z textu vytiahne eventy → JSON
        └─ zapíše do Firestore (kolekcie cities, events)
Firebase Hosting (public/) ── číta z Firestore ── návštevník
```

| Časť | Služba | Prečo zadarmo |
|---|---|---|
| Web | Firebase Hosting | Spark plán: 10 GB úložisko, 360 MB/deň prenos |
| Databáza | Cloud Firestore | Spark plán: 50 000 čítaní, 20 000 zápisov denne |
| Spúšťanie bota | GitHub Actions | verejný repozitár neobmedzene, súkromný 2 000 min/mesiac |
| AI | Gemini API | free tier z Google AI Studio |

Firebase Cloud Functions sa nepoužívajú, lebo plánované funkcie vyžadujú platený plán Blaze.

## Nastavenie krok za krokom

### 1. Firebase projekt
1. https://console.firebase.google.com → **Add project** (Google Analytics netreba).
2. **Build → Firestore Database → Create database** (región `eur3` alebo `europe-west`, production mode).
3. **Project settings → General → Your apps → Web (</>)** → zaregistruj appku a skopíruj `firebaseConfig` do [public/firebase-config.js](public/firebase-config.js).
4. Do [.firebaserc](.firebaserc) zapíš ID projektu.

### 2. Nasadenie webu
```bash
npm install -g firebase-tools
firebase login
firebase deploy
```
Nasadí web, bezpečnostné pravidlá (web smie len čítať) aj index pre dotazy.

### 3. Kľúče pre bota
- **Gemini:** https://aistudio.google.com/apikey → *Create API key*.
- **Firebase service account:** Firebase Console → **Project settings → Service accounts → Generate new private key**. Stiahne sa JSON súbor. Nikdy ho nedávaj do gitu.

### 4. GitHub
1. Nahraj projekt do repozitára na GitHube.
2. **Settings → Secrets and variables → Actions → New repository secret:**
   - `GEMINI_API_KEY` = kľúč z AI Studia
   - `FIREBASE_SERVICE_ACCOUNT` = celý obsah stiahnutého JSON súboru
3. **Actions → Zbieranie eventov → Run workflow** pre prvé spustenie. Potom beží každý deň sám.

## Lokálne spustenie bota
```bash
cd bot
npm install
```
Na Windows (PowerShell):
```
$env:GEMINI_API_KEY="..."; $env:GOOGLE_APPLICATION_CREDENTIALS="C:\cesta\k\service-account.json"
node index.mjs --dry-run --city=bratislava   # len vypíše, nič nezapíše
node index.mjs                               # zapíše do Firestore
```

## Pridanie mesta alebo zdroja
**Zdroje konkrétneho mesta** sú v [bot/cities.json](bot/cities.json). Patria sem stránky mesta, infocentier, divadiel, výstavísk (Agrokomplex, Incheba…) a arén:
```json
{ "id": "poprad", "name": "Poprad", "region": "Prešovský kraj", "sources": ["https://.../podujatia"] }
```

**Celoslovenské zdroje** sú v [bot/national-sources.json](bot/national-sources.json), napríklad predpredajové portály. AI pri každom evente určí mesto. Eventy z miest, ktoré nie sú v cities.json, sa preskočia.

Bot zbiera eventy na 12 mesiacov dopredu.

Funguje to len na stránkach, ktoré majú eventy priamo v HTML. Ak stránka eventy dočítava JavaScriptom, bot uvidí prázdnu stránku (pozri výstup `--dry-run`). Google Search v Gemini sa nepoužíva, lebo na bezplatnom pláne nemá kvótu.

## Limity free tieru Gemini
Google limity občas mení (v roku 2026 ich už niekoľkokrát znížil). Bot volá AI raz za každý zdroj, čaká 7 s medzi volaniami a pri chybe 429 to skúsi znova. Pri desiatkach miest buď zvýš `GEMINI_DELAY_MS`, alebo nastav `GEMINI_MODEL` na lacnejší model (napr. `gemini-flash-lite-latest`, ktorý má vyššie denné limity).

## Štruktúra dát vo Firestore
- `cities/{id}`: `name`, `region`, `upcomingCount`, `lastUpdated`
- `events/{hash}`: `cityId`, `title`, `startDate`, `startTime`, `endDate`, `start` (Timestamp), `venue`, `description`, `category`, `url`, `source`, `updatedAt`

ID eventu je hash z mesta, názvu a dátumu, takže opakované behy nevytvárajú duplikáty. Skončené eventy bot sám maže.
