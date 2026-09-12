# Alvins Route Library — Node.js

A self-hosted GPX route library with search, filters, map previews, elevation profiles,
surface overlays, café stops and GPX downloads. The interface is in Swedish; source code,
variables and filenames are in English. **Python is not required.**

## Upgrade from the Python version

1. Stop the old app with Ctrl+C.
2. Back up its entire **data** folder while the app is stopped.
3. Extract this ZIP into a new folder, for example `C:\Users\alvin\git\route-library`.
4. Copy the old `data` folder into the new project folder, next to `server.js`.
5. Install **Node.js 24 LTS or later** from https://nodejs.org/ if needed.
6. Run **START-DOMAIN.bat** for `https://rutter.alvins.se`, or **START-LOCAL.bat** for local-only testing.

The existing `data/routes.sqlite3` database, route IDs, links and administrator code are retained.
You do not need to re-import GPX files. Sign in again after the upgrade. Do not copy the old `.venv`.

## First-time setup

Install Node.js 24 or later and extract the entire ZIP into a regular folder.
Double-click **START-LOCAL.bat**. The first launch installs the locked npm dependencies.
The local address is **http://localhost:8767**. The administrator code is printed in the terminal.
Click **Lägg till rutt**, enter that code, select a GPX file and import it.

Visitors can browse and download routes without signing in. The code grants permission to add,
edit and delete routes. Keep the terminal open; Ctrl+C stops the server.

For Windows CMD or VS Code's CMD terminal:

```cmd
cd C:\Users\alvin\git\route-library
node start.cjs
```

## Host rutter.alvins.se on your own PC

The Node server listens on **127.0.0.1:8767**. Your existing Cloudflare Tunnel connects that local
server to **https://rutter.alvins.se**. The app and database remain on your PC. GitHub is only for
source control. Neither GitHub Pages nor a paid application host is required by this setup.

If the route already exists, keep it. Otherwise, in Cloudflare open:
**Networking → Tunnels → alvins-pc → Routes → Add route → Published application**.

| Field | Value |
|---|---|
| Subdomain | `rutter` |
| Domain | `alvins.se` |
| Path | Leave empty |
| Service URL | `http://127.0.0.1:8767` |

Save the route, then run **START-DOMAIN.bat**. Use **https://rutter.alvins.se** on your PC too.
The public domain uses HTTPS; the local tunnel service uses HTTP. Do not enter HTTPS for the local
service URL. No router port forwarding is needed. Your existing cloudflared Windows service is reused.
Do not reinstall it, change nameservers or remove the Yatzy route on port 8765.

The PC must remain switched on, connected and awake, with this app running. When it stops,
the public website stops responding. All imported routes are visible to visitors. The admin code
is not included in the public interface. No Cloudflare account settings were changed by this update.

Direct domain startup in CMD:

```cmd
set PUBLIC_URL=https://rutter.alvins.se
node start.cjs
```

## Map previews and visibility

Route cards now show real OpenStreetMap tiles behind the route. Tiles load only when a card becomes
visible. Click the map or route information to open the detail page. The main maps are also lighter:
the previous dark inversion is removed while the surrounding interface remains dark.
Internet access is required for background tiles. Saved routes and GPX downloads remain local.

Tiles use the browser's normal cache. No offline map downloads or prefetching are performed.
Map attribution remains visible. The OSM public tile service is best effort and is not intended for
unlimited traffic. `MAP_TILE_URL` and `MAP_TILE_CREDIT` can select another provider; comply with
that provider's attribution and API-key requirements. The default provider requires no API key.

## Surface detection fix

The previous request used `out tags geom`. The `tags` output mode does not supply the full geometry
needed for matching. Version 2 uses **`out body geom`** and explicitly rejects responses containing
ways without geometry, instead of silently reporting everything as unknown.

The query also includes roads without a `surface` tag. Path and track tags may provide useful
classification, and unknown parallel roads must participate in matching to avoid false assignments.

After upgrading, open the route → **Redigera rutt → Hämta underlagsförslag** to run the corrected
analysis. Existing routes are not automatically sent to an external map service.
The result reports how many roads were fetched, how much of the GPX matched and how much could
be classified. Manual markings always win, including manually assigned unknown stretches.

### Classification

- **Asphalt:** explicitly `surface=asphalt`.
- **Gravel:** gravel, fine gravel, compacted or pebblestone; `tracktype=grade2` without a material
  is an inferred gravel suggestion.
- **Trail:** suitable path/footway/bridleway tags with natural or unspecified surface. This does
  not establish cycling access, MTB suitability or difficulty.
- **Paved, material unknown:** `surface=paved`; this is not presented as asphalt.
- **Unpaved, material unknown:** unpaved or soil-based surfaces; not automatically gravel.
- **Other:** for example concrete, paving stones or wood.
- **Unknown:** missing information, ambiguous matching or no nearby road.

Matching uses nearby road geometry within approximately 30 metres. Conflicting close alternatives
remain unknown. This is a geometric approximation, not Strava's classification or a full routing
engine. Check crossings, parallel roads and GPS deviations and correct manually as needed.

The analysis sends the route's bounding area, not the GPX file itself, to Overpass only after clicking
the button. The service can be unavailable. Limits: 200 km route and a 1,200 km² bounding area,
one request per minute. Larger routes can still be edited manually.

## Editing routes, surfaces and cafés

Choose **Redigera rutt**. Set the start/end distance or select two points on the map, choose a
surface and save. Later markings overwrite earlier ones within the selected interval.
When a route passes the same place more than once, check the kilometre fields after map selection.

For cafés, enter a name/note, choose **Placera på kartan**, click the location and save.
The distance corresponds to the nearest route point; the app does not calculate a detour.
Cafés are included as GPX waypoints. Opening hours are not fetched automatically.

## Data, backups and GitHub

`data/routes.sqlite3` contains route data. `data/config.json` contains the administrator code.
Stop the app and copy the entire data folder to make a backup. Keep this folder during upgrades.
It and `node_modules` are ignored by Git. Do not publish private database or configuration files.

Use normal Git commands for the source. GitHub Pages should remain disabled. The startup helper
installs dependencies again when `package-lock.json` changes.
Environment variables: `PUBLIC_URL`, `ADMIN_PASSWORD`, `MAP_TILE_URL`, `MAP_TILE_CREDIT`.
Admin sessions are kept in memory and expire after 24 hours or a restart.

## GPX and elevation

Maximum 20 MB and 60,000 points per file. Track segments and route points are supported.
Separate tracks are not connected by artificial lines. Distance is calculated from coordinates.
Elevation gain uses a 3 m threshold to suppress small fluctuations and may differ from Strava/Garmin.
Missing elevation is indicated. Exports include geometry, height, names, descriptions and cafés,
but not timestamps, heart rate or power. Surface colours are stored in this app and are not a
standard GPX surface layer for cycling computers. Strava URLs are stored as links, not imported
automatically: export the route as GPX first.

## Development and validation

Node.js, Express, built-in SQLite, multer and fast-xml-parser; Leaflet for maps.
Dependencies are locked in `package-lock.json`. Leaflet's license is included in `dist/vendor`.

```cmd
npm ci
npm test
```

Tests cover GPX import/export, existing database compatibility, authentication, updates, surface
intervals, geometry matching and missing-geometry errors. Live Overpass validation was blocked by
HTTP errors/timeouts from this environment. Windows startup and map appearance in a browser
still need to be checked on your PC.

References:
- https://dev.overpass-api.de/overpass-doc/en/targets/formats.html
- https://wiki.openstreetmap.org/wiki/Key:surface
- https://operations.osmfoundation.org/policies/tiles/
- https://nodejs.org/api/sqlite.html
