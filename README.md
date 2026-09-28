# Vattennät V1

Första prototypen av en Windows-app för att bygga vattenfördelningsnät.

## Funktioner i V1
- Obegränsad canvas med zoom/pan
- Rör med dimension och längd
- Böjar
- T-kopplingar
- X-kopplingar
- Inloppsmätare med flöde/tryck
- Hushållsmätare med flöde/tryck och profil
- Koppla komponenter genom att dra mellan portar
- Spara/ladda projekt som JSON
- Exportera mätare till CSV

## Köra som webbapp
Installera Node.js 20+.

```powershell
npm install
npm run dev
```

## Bygga Windows .exe
Installera Rust och Tauri-förutsättningar för Windows. Därefter:

```powershell
npm install
npm run tauri build
```

Installationsprogrammet hamnar normalt under `src-tauri\target\release\bundle\nsis\`.

Detta är V1: hydraulisk simulering, läckor, timprofiler, MQTT/API och avancerad kopplingslogik kommer i nästa iteration efter test av editorn.
