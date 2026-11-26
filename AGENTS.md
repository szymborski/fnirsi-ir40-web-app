# AGENTS.md

Static PWA, vanilla ES modules, no build step, no backend. Hosted on GitHub Pages. UI language: Polish. Code comments: English, ASD-STE100 (short, simple).

## Commands

- Dev server (no cache): `python3 dev/serve.py` → http://localhost:8640/?demo (`?demo` seeds sample data, `?sim` = fake rangefinder).
- Tests: `node tests/run.mjs` (parser with real packets, geometry, units).
- README screenshots: start dev server, then `node dev/screenshots.mjs` (headless Chrome via CDP).
- BLE sniffer: `dev/sniff.py` (needs `pip install bleak`).

## Git

- Commit messages: English, Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- No `Co-authored-by` or other trailers. No mention of tools or assistants in commits, PRs, code or docs.

## FNIRSI IR40 BLE protocol (confirmed on real device, 2026-11-26)

- Advertised name: `fnirsi.etool.40mpro`. Advertised service UUID: `0xAF30` (NOT `0xEE01`).
  → `requestDevice` filter: `namePrefix: 'fnirsi'` (lowercase, case-sensitive). Put `0xEE01` in `optionalServices`. A filter on `services: [0xEE01]` does not match the advertisement.
- GATT: service `0xEE01`: `0xEE02` notify (device→app), `0xEE03` write (app→device). Also service `0xDD01` (`DD02` notify, `DD03` write): unknown, not used. MTU 185.
- Packet: `u16 BE payload length` + records of 7 bytes: `02 <tag> <type> <u32 BE value>`.
  - Tags: `01` mode (0 = linear), `05` result, `06` unit (0 = m), `0A` reference (front/back), `02`/`03` sides in area mode, `08` continuous (command).
- Linear measure (confirmed): `00 15 02 01 14 00000000 02 05 14 00000A32 02 06 14 00000000` → 2610 mm. Value is mm.
- Status packet (confirmed): `00 0E 02 06 14 00000000 02 0A 14 00000001`. Comes on connect and again every ~10–25 s. It has no result tag: ignore it.
- Value 0 = no valid reading. Ignore it.
- NOT confirmed on device (from other repos, not used): continuous on/off `00 07 02 08 0E 00 00 00 01/00`, keep-alive ping `00 01 02`, ft/in encoding, area/volume modes. App uses only linear mode and warns when unit ≠ m.
- End-to-end confirmed: desktop Chrome (macOS) → Web Bluetooth → reading lands in the selected edge.

## Non-obvious problems

- **iOS**: Safari (and Chrome/Edge on iOS) has no Web Bluetooth. Use Bluefy (free, has `getDevices()`) or the beacio Safari extension (iOS 26.2+, not tested).
- `requestDevice` needs a user gesture. After the first pick, `reconnectKnown()` uses `navigator.bluetooth.getDevices()` when the browser has it.
- After reconnect, `getCharacteristic` can return the same object. Keep the same listener reference (`this.onValue`), or each reading fires twice.
- **macOS**: a process without Bluetooth permission (TCC) dies with SIGABRT (exit 134) on scan, for example in a sandboxed shell. Run the sniffer from a terminal app that has Bluetooth permission. A short scan can miss the device name: scan 12 s and read `adv.local_name`.
- Embedded browsers (Electron, WebView) can expose `navigator.bluetooth` but show no device chooser. Test real BLE in desktop Chrome (confirmed working) or Bluefy.
- Storage: IndexedDB only. Safari can delete script storage after 7 days without use. Removing Bluefy removes its data. Keep backup export/import working.
- Photos: scale to max 2560 px JPEG before save. The browser applies EXIF rotation on draw.
- Service worker: network-first (no stale deploys). In WKWebView browsers (Bluefy) a service worker can be absent. The app must work without it. Change `CACHE` in `sw.js` when the file list changes.
- Static servers send heuristic cache headers, so the browser keeps old ES modules. Use `dev/serve.py` (`Cache-Control: no-store`).
- Editor gestures: in the Wall tool, a drag from a free end of an open wall line continues the line. A drag from another vertex of the selected shape moves that vertex. Hand tool: drag moves the selected shape or its vertex, else pans.
- `setPointerCapture` throws for synthetic `PointerEvent`s (tests). It is wrapped in try/catch.
- Data model: world units = mm (sketch) or image px (photo). Edge values are stored in mm (`shape.edges[i].v`). Area uses measured lengths + drawn directions (`geometry.rebuild`), so the drawing scale does not matter.
- Debug handle: `window.dalmierzEditor` is the open editor.
