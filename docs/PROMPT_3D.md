# Prompt — Zwiftfree: visuale 3D realistica (prima e terza persona)

Lavori sul repository **Zwiftfree** (app di ciclismo indoor sulle strade del Ticino). Leggi prima
`README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` e `docs/API.md`: lo stack, le convenzioni e le scelte già
fatte valgono anche qui. Il tuo compito è aggiungere alla schermata di pedalata una **visuale 3D il più possibile
fedele al paesaggio reale**, con camera in **prima** o **terza persona**, scelta nelle **Impostazioni**. La
visuale 2D attuale (MapLibre) resta e rimane quella predefinita.

## 0. Regole (come nel resto del progetto)

- Codice e commenti in inglese, interfaccia in italiano tramite il sistema i18n esistente
  (`core/i18n/translations.it.ts`, chiavi pronte per il tedesco).
- Usa le **ultime versioni stabili verificate** delle librerie (controlla npm / Maven Central prima di scegliere,
  annota le versioni in `docs/ARCHITECTURE.md`).
- **Nessun segreto nel codice.** Non usare Cesium ion, Google o altri servizi con chiave: solo dati swisstopo
  aperti, serviti da swisstopo o dal nostro backend.
- **Non scaricare dati da solo**: i download dei dati geografici vanno in uno script in `data/` che l'utente lancia
  (come `data/scarica_ticino.py`). I dati generati non vanno nel repository (`data/out/` è già in `.gitignore`).
- Ogni scelta non ovvia va in `docs/DECISIONS.md` (nuova sezione "3D view").
- Qualità come il resto: `OnPush`, signals, lazy loading, ESLint + Prettier, Spotless, test.
- **Non fare commit** se non te lo chiedo. Fermati alla fine di ogni fase (sezione 9) con un riassunto e aspetta.
- **Verifica ogni URL e ogni nome di dataset prima di usarlo** (vedi sezione 2): quelli qui sotto sono indicazioni,
  non garanzie. Se un servizio non esiste più o ha condizioni diverse, fermati e chiedimi.

## 1. Cosa deve vedere l'utente

- **Impostazioni → "Visuale della pedalata"**:
  - *2D (mappa)* — quella di oggi, predefinita;
  - *3D — terza persona*: camera dietro e sopra il ciclista, che si vede in sella;
  - *3D — prima persona*: camera all'altezza degli occhi, si vede la strada davanti (e il manubrio, opzionale).
  - Sotto: *"Oscillazione della testa"* (on/off, solo prima persona, default off) e *"Qualità 3D"*
    (bassa / media / alta, default media).
- Nella schermata pre-partenza e durante la pedalata: un pulsante e il tasto **V** per passare al volo
  2D → 3D terza → 3D prima persona (senza salvare l'impostazione).
- HUD, profilo altimetrico, frecce di svolta, riquadro avatar, pannello simulatore/rullo, banner (caduta, pausa
  pipì): **identici** in 2D e 3D, sovrapposti alla scena 3D.
- Se il 3D non è possibile (niente WebGL2, oppure meno di 25 fps per 10 s di fila) l'app torna al 2D con un avviso
  ("Il 3D è troppo pesante per questo dispositivo: torno alla mappa 2D").

## 2. Dati: cosa usare e dove trovarli

Tutti i dati sono di **swisstopo** e sono *Open Government Data* dal 1° marzo 2021: gratuiti anche per uso
commerciale, con l'obbligo di attribuzione **"© swisstopo"**. Verifica le condizioni attuali su
<https://www.swisstopo.admin.ch> (sezione dati gratuiti / condizioni d'uso) e il fair use dei servizi
`geo.admin.ch` prima di usarli in streaming.

### 2.1 Servizi ospitati da swisstopo (fase A: nessun download)

Sono quelli che usa la vista 3D di <https://map.geo.admin.ch>. **Trova gli URL esatti** aprendo map.geo.admin.ch
in 3D e guardando le richieste di rete nel browser, oppure nella documentazione / nel codice sorgente pubblico di
map.geo.admin.ch su GitHub (`geoadmin`). Ti servono:

| Cosa | Dataset swisstopo | Formato atteso |
| --- | --- | --- |
| Terreno | swissALTI3D (+ DHM25 fuori dal dettaglio massimo) | Cesium *quantized-mesh* terrain |
| Foto aeree | SWISSIMAGE (10 cm) | WMTS, tile in EPSG:3857 o 4326 |
| Edifici | swissBUILDINGS3D | Cesium 3D Tiles (b3dm / glTF) |
| Vegetazione (alberi) | dataset vegetazione 3D, se pubblicato | Cesium 3D Tiles |
| Nomi di luogo | swissNAMES3D | 3D Tiles o vettoriale |

Per le foto aeree il WMTS dovrebbe seguire lo stesso schema che l'app usa già per la carta
(`shared/map/map-style.ts`, `SWISSTOPO_TILES`) con il livello `ch.swisstopo.swissimage`; controlla nel
*GetCapabilities* (`https://wmts.geo.admin.ch/EPSG/3857/1.0.0/WMTSCapabilities.xml`) nome del livello, formato e
zoom massimo.

### 2.2 Dati da scaricare (fase C: per l'uso offline e per realismo extra)

Scaricali con l'**API STAC** di swisstopo, `https://data.geo.admin.ch/api/stac/` (verifica la versione e l'elenco
`collections`; i nomi qui sotto vanno confermati lì). Limita i download al **riquadro del Ticino** (lo stesso
bounding box usato da `data/scarica_ticino.py`) o, meglio, a un **corridoio di 500 m attorno ai percorsi**.

| Collezione (da verificare) | Contenuto | A cosa serve |
| --- | --- | --- |
| `ch.swisstopo.swissalti3d` | modello del terreno, GeoTIFF 0.5 m / 2 m | terreno self-hosted (quantized-mesh) |
| `ch.swisstopo.swissimage-dop10` | ortofoto 10 cm, GeoTIFF | texture del terreno self-hosted |
| `ch.swisstopo.swissbuildings3d_3_0` (o la versione corrente) | edifici 3D | 3D Tiles self-hosted |
| `ch.swisstopo.swisssurface3d-raster` | modello delle superfici (con alberi ed edifici) | altezza degli alberi |
| `ch.swisstopo.swisstlm3d` | modello topografico (bosco, alberi isolati, siepi…) | dove mettere gli alberi |

## 3. Scelta tecnica

- **Motore 3D: CesiumJS** (open source, Apache-2.0), installato da npm. È l'unico modo realistico per avere
  terreno ad alta risoluzione caricato a tile, ortofoto, edifici 3D Tiles e una camera libera ad altezza d'occhi.
  MapLibre con terreno resta sufficiente per una terza persona "da drone", ma in prima persona il suolo da vicino è
  piatto e sfocato: non basta per l'obiettivo "più realistico possibile".
- **Niente Cesium ion**: crea il `Viewer` senza i servizi ion (niente token, niente base layer predefinito,
  niente geocoder, timeline, animation widget). Terreno, immagini e tile solo dalle fonti della sezione 2.
- **Caricamento lazy**: Cesium è grande. Va caricato solo quando l'utente sceglie il 3D (import dinamico nel
  componente della scena), mai nel bundle iniziale (budget attuale: 800 kB di avviso, oggi siamo a ~675 kB).
  Copia gli asset statici di Cesium (Workers, Assets, ThirdParty, Widgets) con `angular.json` → `assets` e imposta
  `CESIUM_BASE_URL`. Verifica che il build Docker (nginx) li serva con i MIME type giusti.
- **La fisica non cambia**: `physics/ride-engine.ts`, `physics/course.ts` restano la fonte di verità (posizione,
  quota, pendenza, direzione). La scena 3D *legge* lo stato a ogni frame e lo disegna.

## 4. Architettura frontend

- Nuovo componente `features/ride/ride-scene-3d.ts` (+ file di supporto in `features/ride/scene3d/`) con la stessa
  interfaccia di `ride-map.ts` (stessi input: posizione interpolata, heading, traccia del percorso, stato
  dell'avatar, cadenza). `ride-page.html` mostra `app-ride-map` **o** `app-ride-scene-3d` a seconda della visuale.
- Funzioni **pure e testate** in `features/ride/scene3d/camera.ts`:
  - `thirdPersonPose(point, headingDeg, gradePct, opts)` → posizione e orientamento camera;
  - `firstPersonPose(point, headingDeg, lookAheadPoint, opts)`;
  - smorzamento a molla critica per posizione e direzione (niente scatti a 10 Hz di fisica / 60 Hz di render).
- Interpolazione: la scena usa la stessa interpolazione `requestAnimationFrame` già usata dalla mappa 2D.

### 4.1 Camera in terza persona
- Dietro al ciclista di 6–8 m, 2.5–3 m sopra la strada, puntata su un punto 15–20 m avanti lungo il percorso
  (non sulla tangente: così in curva si vede dove si va).
- Direzione da `course.headingAt(m, span)` con uno span più largo (es. 20 m) per non ruotare a ogni vertice.
- In salita la camera si alza un po' e guarda più in alto, in discesa il contrario.
- FOV 60°.

### 4.2 Camera in prima persona
- Occhi a **1.55 m** sopra la superficie della strada nella posizione del ciclista; sguardo verso un punto 12–15 m
  avanti lungo il percorso alla stessa altezza relativa, così su una salita la vista si inclina con la strada.
- FOV 70–75°.
- Oscillazione della testa (solo se attiva nelle impostazioni): ±1.5 cm in verticale, a metà del ritmo di
  pedalata (cadenza reale), ±0.5° di rollio. Spenta di default: provoca mal di mare.
- Opzionale: manubrio e mani in basso nell'inquadratura (modello glTF agganciato alla camera).

### 4.3 Altezza corretta (niente camera sotto terra)
- La quota della strada (dai nostri dati, swissALTI3D) e quella del terreno 3D possono differire di qualche metro.
- Per la posizione del ciclista e della camera usa la **quota della strada**; campiona anche l'altezza del terreno
  (`globe.getHeight` / `sampleHeightMostDetailed`) e, se la camera finirebbe sotto il terreno, alzala.
- **Ponti**: la strada è sopra il terreno, va bene la quota della strada.
- **Gallerie** (archi con `tunnel` nei dati della rete, verifica il campo in `road_edges`): sfuma a nero entrando,
  mostra "Galleria" e un tubo scuro semplice o passa temporaneamente alla mappa 2D; riprendi all'uscita.

## 5. Realismo

1. **Terreno** swissALTI3D + **ortofoto** SWISSIMAGE come texture: è la base, mostra già strade, campi, boschi e
   tetti veri dall'alto.
2. **Edifici** swissBUILDINGS3D (3D Tiles). Sono senza texture: dai un materiale chiaro realistico e ombre.
3. **Alberi**:
   - se swisstopo pubblica la vegetazione in 3D Tiles, usala;
   - altrimenti generali tu (fase C): posizioni da swissTLM3D (bosco, alberi isolati), altezza dalla differenza
     superficie − terreno (swissSURFACE3D − swissALTI3D), 2–3 modelli glTF di latifoglie e conifere in
     instancing, scalati con l'altezza misurata. Solo in un corridoio di ~300 m attorno alla strada.
4. **La strada sotto le ruote**: l'ortofoto da vicino è sgranata. Disegna un nastro d'asfalto lungo la traccia
   (geometria 3D degli archi già in `course.ts`), largo secondo il tipo di strada (es. 3 m strade locali, 6–7 m
   principali), con texture d'asfalto e linea di mezzeria dove ha senso, sollevato di pochi centimetri sul
   terreno per evitare lo z-fighting.
5. **Cielo, sole e luce**: atmosfera di Cesium, posizione del sole all'ora reale di Lugano, ombre (qualità
   media/alta), nebbia in lontananza per nascondere il caricamento delle tile.
6. **Avatar 3D** (terza persona): modello glTF **originale** di ciclista con bici (fatto in Blender, oppure un
   modello con licenza che permetta l'uso; annota la licenza in README). Colori di maglia, casco e bici
   dall'`AvatarConfig` dell'utente. Animazioni:
   - pedalata legata alla cadenza reale;
   - ruota libera (gambe ferme);
   - pausa pipì: bici appoggiata, ciclista dietro un cespuglio;
   - caduta: bici a terra e ciclista sdraiato, poi si rialza (stati `CRASHED`, `RECOVERING` della macchina a
     stati in `avatar/avatar-machine.ts`).

   Se le animazioni 3D diventano troppo costose, nella prima versione tieni il riquadro avatar 2D esistente e
   in scena un ciclista con la sola pedalata.
7. **Caricamento in anticipo**: precarica le tile lungo i prossimi 1–2 km del percorso (su un percorso
   pianificato si conosce tutta la traccia; in giro libero l'arco tentativo successivo).

### Qualità bassa / media / alta
| | bassa | media | alta |
| --- | --- | --- | --- |
| `maximumScreenSpaceError` terreno/tile | 4 | 2 | 1.33 |
| ombre | no | sì | sì, più morbide |
| edifici | no | sì | sì |
| alberi | no | corridoio 150 m | corridoio 300 m |
| risoluzione di rendering | 0.75× | 1× | `devicePixelRatio` |

## 6. Backend

- **Impostazioni** (stesso schema di `corner_assist_enabled`):
  - migrazione `V5__ride_view.sql`: in `user_settings` aggiungi `ride_view text NOT NULL DEFAULT 'MAP_2D'
    CHECK (ride_view IN ('MAP_2D','THIRD_PERSON','FIRST_PERSON'))`, `head_bob_enabled boolean NOT NULL DEFAULT
    false`, `scene_quality text NOT NULL DEFAULT 'MEDIUM' CHECK (scene_quality IN ('LOW','MEDIUM','HIGH'))`;
  - `user/UserSettings.java`, `user/MeDtos.java` (`SettingsDto`, `SettingsUpdate` con validazione),
    `user/MeService.java`;
  - test in `MeIntegrationTest` (valori validi, valore non valido → 400).
- **Fase C (self-hosting)**: endpoint che servono terreno, ortofoto ed edifici generati in `data/out/3d/`:
  - `GET /api/3d/terrain/layer.json` e `GET /api/3d/terrain/{z}/{x}/{y}.terrain`;
  - `GET /api/3d/imagery/{z}/{x}/{y}.jpg`;
  - `GET /api/3d/buildings/tileset.json` e i file collegati.

  Tutti con cache HTTP lunga e `Content-Encoding` corretto (le tile quantized-mesh sono spesso gzip). Pubblici
  come `/api/tiles/**`. In `docker-compose.yml` monta `data/out/3d` in sola lettura come già `data/out`.
  Documenta tutto in `docs/API.md`.

## 7. Script dei dati (fase C, li lancia l'utente)

`data/scarica_3d.py`:
1. legge il riquadro del Ticino (o i percorsi da `data/out/` per un corridoio di 500 m);
2. interroga l'API STAC di swisstopo e scarica solo le tile necessarie di swissALTI3D, SWISSIMAGE,
   swissBUILDINGS3D, swissSURFACE3D, swissTLM3D in `data/cache/3d/`, riprendendo i download interrotti;
3. genera:
   - terreno quantized-mesh (es. con un tool open source come *cesium-terrain-builder* via Docker, oppure una
     libreria Python equivalente; scegli e annota in DECISIONS);
   - piramide di tile dell'ortofoto;
   - 3D Tiles degli edifici;
   - un file degli alberi (posizione, altezza, tipo);
4. scrive tutto in `data/out/3d/` con un `stats.json` (dimensioni, data, versioni dei dataset).

Stima e mostra lo spazio su disco prima di scaricare. Aggiorna il README: tempi, spazio, come lanciarlo.

## 8. Test

- Unit (Vitest):
  - funzioni della camera: posizione dietro al ciclista, sguardo in avanti in curva e in salita, smorzamento
    senza oscillazioni, camera mai sotto il terreno;
  - scelta della visuale nel ride screen;
  - fallback al 2D;
  - tasto V.

  Lo stub della scena 3D nei test dei componenti, come già si fa per la mappa.
- Integrazione backend: impostazioni nuove; in fase C gli endpoint dei dati 3D (tile esistente, tile mancante →
  404, header di cache).
- End-to-end (Playwright, `frontend/zwiftfree-fe/e2e/`): imposta "3D — terza persona" nelle impostazioni,
  avvia una pedalata in simulatore, verifica che ci sia il canvas 3D, che l'HUD funzioni, nessun errore in
  console, cambio visuale con V; stessa cosa in prima persona. Screenshot per il README con `SCREENSHOTS=1`.
- Prova manuale con il rullo vero (Tacx Flux-2) su *Cadenazzo – Monte Ceneri*: fluidità, nessun mal di mare,
  fps.

## 9. Fasi (fermati e riassumi dopo ognuna)

- **Fase A — 3D con i servizi swisstopo**:
  - impostazioni (backend + frontend);
  - Cesium lazy;
  - terreno + ortofoto + edifici dai servizi ospitati;
  - camera terza e prima persona;
  - HUD sovrapposto;
  - fallback al 2D;
  - test.
- **Fase B — realismo**:
  - nastro d'asfalto;
  - sole, ombre, nebbia;
  - avatar 3D animato con i colori dell'utente;
  - gallerie;
  - precaricamento lungo il percorso;
  - livelli di qualità.
- **Fase C — dati propri** (offline e alberi):
  - script `data/scarica_3d.py`;
  - endpoint del backend;
  - alberi in instancing;
  - scelta in configurazione tra servizi swisstopo e dati locali.
- **Fase D — rifinitura**:
  - prestazioni (obiettivo 60 fps su un portatile recente a qualità media);
  - screenshot;
  - README (requisiti di GPU, attribuzioni "© swisstopo", licenza Cesium e dei modelli 3D);
  - DECISIONS.

Inizia dalla fase A. Prima di scrivere codice mostrami in breve: versioni scelte, URL dei servizi swisstopo che hai
verificato (con le condizioni d'uso), e come pensi di integrare Cesium nel build Angular.
