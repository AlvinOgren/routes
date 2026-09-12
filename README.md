# Alvins Ruttbank

En lokal webbapp för att samla cykelrutter från GPX-filer. GitHub kan användas för versionshantering;
webbappen och rutterna körs och lagras på din dator. Ingen GitHub-publicering ingår.

## Starta i Windows

1. Packa upp **hela ZIP-filen** i en vanlig mapp, exempelvis `C:\Users\alvin\git\ruttbanken`.
2. Dubbelklicka **START.bat**. Python 3.10 eller senare behövs, liksom internet vid första starten.
   Python-paketen installeras automatiskt i projektets `.venv`.
3. Webbläsaren öppnar **http://localhost:8767**.
4. Klicka **Lägg till rutt**. Ange administratörskoden som visas i det svarta startfönstret.
5. Välj en GPX-fil, fyll i namn, beskrivning och ruttyp och klicka **Importera rutt**.

Koden sparas mellan omstarter. Besökare behöver ingen kod för att söka, se eller ladda ned rutter.
Lämna startfönstret öppet medan appen används. Ctrl+C stänger servern.
Om `py` saknas, installera Python från https://www.python.org/downloads/windows/.
Port 8767 är separat från din Yatzy-app på 8765.

## Vad som finns

- Sökning i ruttnamn, beskrivning och startområde.
- Filter för ruttyp, distans, underlag och fikastopp; sortering på datum, namn, längd och stigning.
- Förhandsvisning av det verkliga GPX-spårets form i varje ruttkort.
- Interaktiv översiktskarta samt en egen detaljsida med permanent länk per rutt.
- Mörk OpenStreetMap-bakgrund, färgkodade sträckor, start/mål och fikamarkörer.
- Distans, uppskattade höjdmeter och interaktiv höjdprofil.
- Redigering av information, vägunderlag och fikastopp för administratören.
- Valfria automatiska underlagsförslag från OpenStreetMap via Overpass.
- GPX-nedladdning utan aktivitetsdata som tid, puls eller effekt.
- Lokal SQLite-databas: rutterna finns kvar när appen startas om.

Gravel/landsväg/MTB är ruttyp som du väljer. Underlag är en separat uppgift per sträcka.
En gravelrutt kan därför innehålla både asfalt, grus och stig.

## Underlag längs rutten

GPX innehåller normalt koordinater och ibland höjd, men inte vägunderlag.
Vid import blir därför hela spåret **okänt**, oavsett vald ruttyp.

Öppna rutten och välj **Redigera rutt**:

1. Ange från/till kilometer, eller klicka **Välj två punkter på kartan**.
2. Klicka på två punkter på spåret. Vid en korsning eller där rutten passerar samma plats flera gånger,
   kontrollera kilometerfälten: kartvalet väljer den närmaste registrerade punkten och kan välja fel passage.
3. Välj underlag och **Spara sträckan**. Du kan markera hela rutten och sedan korrigera mindre delar.

Grus visas i gult, asfalt i cyan, stig i lila, annat i rosa och okänt i grått.
Sparade intervall kan överlappa: den senaste manuella markeringen ersätter den tidigare i det valda intervallet.

### Automatiska kartförslag

**Hämta underlagsförslag** frågar Overpass om kartlagda vägunderlag inom ruttens geografiska område.
Detta sker först när du trycker på knappen. GPX-filen skickas inte; dess avgränsande kartområde skickas.
Resultatet sparas, så besökare behöver inte göra nya hämtningar.

- Matchningen jämför spåret med kartlagda vägar i närheten, inom ungefär 18 meter.
- Otydliga matchningar till parallella vägar med olika underlag blir okända.
- `surface=asphalt` blir asfalt. Grus, fint grus och kompakterat underlag grupperas som grus.
- Stigar med angivet naturunderlag grupperas som stig. Detta är **inte** information om tillåten cykling,
  svårighetsgrad eller om rutten passar din cykel.
- Generella `paved` eller `unpaved` blir inte automatiskt asfalt eller grus.
- **Manuella markeringar behålls**, även om du manuellt valt okänt.
- Gräns: 200 km rutt och ett avgränsande område på högst 1 200 km². Större rutter kan fortfarande
  importeras och markeras manuellt. Kartförfrågningar begränsas till en per minut.
- Overpass är en extern tjänst som kan vara upptagen eller otillgänglig. Då visas ett fel och de
  tidigare underlagen behålls.

Detta är en konservativ geometrisk uppskattning, **inte Stravas klassificering eller en fullständig
vägnätsmatchning**. Kontrollera förslagen, särskilt korsningar, parallella stigar och GPS-avvikelser.
Saknad OSM-information lämnas okänd.

## Fikastopp

Öppna **Redigera rutt**, fyll i namn och anteckning, välj **Placera på kartan**, klicka på platsen
och spara fikastoppet. Listan visar ungefär vid vilken kilometer i rutten stoppet ligger.
Markören kan ligga en bit från rutten om caféet kräver en omväg; någon ny väg dit beräknas inte.
Fikastoppen inkluderas som waypoints i GPX-exporten. Öppettider hämtas inte automatiskt.

## På din domän

Projektet är förberett för **https://rutter.alvins.se**, men inget är publicerat eller ändrat i Cloudflare.
Använd din befintliga tunnel om du vill köra från samma Windows-dator som Yatzy:

1. Cloudflare → **Networking → Tunnels → alvins-pc → Routes → Add route → Published application**.
2. Fyll i:

   | Fält | Värde |
   |---|---|
   | Subdomain | `rutter` |
   | Domain | `alvins.se` |
   | Path | Lämna tomt |
   | Service URL | `http://127.0.0.1:8767` |

3. Spara routen. Yatzys route lämnas kvar.
4. Stäng Ruttbankens tidigare startfönster och kör **START-DOMAN.bat**.
5. Öppna HTTPS-adressen, även när du använder appen på serverdatorn.

Du behöver inte ändra namnservrar eller installera cloudflared igen. Datorn behöver vara på,
internetansluten och vaken. Besökare kan se alla uppladdade rutter; administratörskoden ger skrivrättigheter.
Ruttdatabasen går senare att flytta med appen till en server som kan köra Python.

För en annan domän ändrar du `PUBLIC_URL` i START-DOMAN.bat och motsvarande tunnelroute.
Ange inte HTTP-adressen till den offentliga webbplatsen; använd HTTPS.

## Kartor och internet

Bakgrundskartan använder OpenStreetMaps standardkartor med en mörk färgbehandling i webbläsaren.
Kartkällan är riktig geodata. Karttexter och vägar färgsätts om; detta är inte en satellitkarta eller 3D-karta.
Ruttlinjerna och deras underlagsfärger påverkas inte av färgbehandlingen.
Det finns synlig källhänvisning på kartan. En internetanslutning behövs för bakgrundskartan och OSM-förslag.
Utan kartanslutning finns uppladdade spår, information och nedladdningar fortfarande lokalt.

Ingen API-nyckel krävs för den medföljande standardkartan. OSM:s offentliga servrar är en best-effort-tjänst
med användningsregler och passar inte obegränsad trafik eller nedladdning av offlinekartor.
Appen hämtar endast kartbilder för den visade kartan och låter webbläsaren sköta caching.
Översikten visar högst 100 ruttspår samtidigt; fler rutter är fortfarande sökbara och öppningsbara.

För en annan kartleverantör kan du sätta miljövariabler före start:

```cmd
set MAP_TILE_URL=https://din-leverantor/{z}/{x}/{y}.png
set MAP_TILE_CREDIT=Leverantörens namn
```

Kontrollera leverantörens attribution, nycklar och villkor. Standardens mörka CSS-filter i
`dist/styles.css` bör tas bort om leverantören redan levererar en mörk karta.

## Data och GitHub

All beständig data ligger i **data/**:

- `routes.sqlite3`: rutternas koordinater, namn, beskrivningar, underlag och fikastopp.
- `config.json`: sessionshemlighet och lokal administratörskod. Dela inte denna fil.

Ta backup genom att **stänga appen och kopiera hela data-mappen**. Vid återställning stänger du appen
och lägger tillbaka mappen. Git ignorerar data-mappen, så att GPX-positioner och administratörskod inte
råkar laddas upp till GitHub. Behåll den även när du uppdaterar programfilerna.

Du kan byta kod genom att ange `ADMIN_PASSWORD` som miljövariabel innan start. Gör sedan en omstart.

För att versionshantera koden i CMD, från projektmappen:

```cmd
git init
git add .
git commit -m "Skapa ruttbanken"
git branch -M main
```

Skapa sedan ett tomt GitHub-repository och följ GitHubs instruktioner för att lägga till remote och pusha.
Aktivera inte GitHub Pages. GitHub används enbart för källkoden.

## GPX och beräkningar

- Import: `.gpx`, högst 20 MB och 60 000 punkter. Stöd för både track segments och route points.
- Filer med ogiltiga koordinater, trasig XML eller mindre än en meters spår avvisas.
- Distans beräknas som avstånd över jordytan mellan GPX-punkterna. Separata spårsegment kopplas inte ihop.
- Höjdmeter använder en tröskel på 3 m för att minska små höjdvariationer. Inga externa höjddata hämtas.
  Värdena är uppskattningar och kan avvika från Strava, Garmin och andra appar.
- Vid ofullständig eller saknad höjddata visas detta tydligt.
- **Exporten innehåller geometri, höjd, ruttnamn, beskrivning och fikastopp.** Ursprungliga tidsstämplar,
  puls, kadens och effekt följer inte med. Underlagsfärger är webbappens data och överförs inte som en
  standardiserad underlagsvisning till cykeldatorn.
- En Stravalänk sparas som länk; appen loggar inte in på Strava eller hämtar rutter därifrån automatiskt.
  Exportera rutten som GPX och importera filen här.

## Teknik och verifiering

HTML, CSS och JavaScript i gränssnittet, Leaflet 1.9.4 för kartan. Python/Flask/Waitress och SQLite
för server, åtkomst och beständig lagring. Leaflet är medpackat med sin BSD-licens.
Övriga beroenden installeras separat enligt `requirements.txt`.

Verifierat i utvecklingsmiljön: GPX-import, distans/höjdberäkning, flera spårsegment, GPX-export,
beständig lagring, administratörsåtkomst, ändringskonflikter, underlagsintervall, kartans färggränser,
och OSM-matchning med testdata. Björsäter-filen har provlästs med 9 561 punkter.
Livehämtning från Overpass, gränssnittet i en riktig webbläsare och Windows-startfilerna har inte
testats här. De tidigare uppladdade privata rutterna medföljer inte projektet.

Kör tester från projektmappen efter första starten:

```cmd
.venv\Scripts\python -m unittest discover -s tests -v
node tests/geometry.test.cjs
```

Node behövs bara för JavaScript-testet, inte för att köra appen.

Källor och kartvillkor:

- https://leafletjs.com/reference.html
- https://www.openstreetmap.org/copyright
- https://operations.osmfoundation.org/policies/tiles/
- https://wiki.openstreetmap.org/wiki/Key:surface
- https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL
