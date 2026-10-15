# BC125AT CPS for the web

> [!WARNING]
> **This is Claudeslop.** Nearly all of this app — the code, the protocol work, and this README —
> was written by Claude, with a human pointing at things and plugging in the scanner. Keep a
> backup and set your expectations accordingly.

The browser version of [BC125AT CPS](https://github.com/galenguyer/BC125AT-CPS), for programming the
**Uniden BC125AT** handheld scanner over USB: read the scanner, edit its 500 channels and settings,
and write the changes back. It runs in any Chromium-based browser, on macOS, Windows, Linux,
ChromeOS and Android, with no install and no driver.

It does everything the Mac app does:

- **Read from Scanner** loads every channel, bank, search, Close Call and lockout setting.
- **Edit** in a spreadsheet-style table: select cells, type to edit, Tab through Name and Frequency,
  drag channels between slots and onto banks in the sidebar, bulk-edit from the context menu, and
  copy and paste with Numbers, Excel or Google Sheets. Every edit can be undone.
- **Write to Scanner** shows exactly what will change, backs up the scanner first, writes only the
  differences, then reads the scanner back to check every one.
- **Checks before writing**: 16-character names, one priority channel per bank, 100 global
  lockouts, and the scanner's channel step plan, so you're told that 154.0062 MHz will be stored
  as 154.0025.
- **Live bar**: what the scanner is receiving, the last transmission heard, Scan and Hold, and
  volume and squelch sliders. Right-click a channel and choose **Listen on Scanner** to hold on it.
- **Compare with Scanner** lists how the scanner differs from your document without writing.
- Opens and saves `.bc125at` files — byte-for-byte the same files the Mac app writes — imports and
  exports CSV (including bc125py's), and opens and saves Uniden's own `.bc125at_ss` files.

Your document is saved in the browser as you work, so closing the tab or reloading never loses it.
Backups of the scanner taken before each write are kept in the browser too (**Scanner ▸ Backups**).

## Browsers

The scanner is reached with **WebUSB** or **Web Serial**, which only Chromium-based browsers have:
[Helium](https://helium.computer) (recommended), Chrome, Edge, Opera, Vivaldi. Safari, Firefox and
every iOS browser can't talk to USB devices; the app says so, and can still edit files there.

| System | Connects with | Notes |
|---|---|---|
| macOS | WebUSB | macOS has no driver for the scanner, so the browser claims it directly |
| Windows | Web Serial | Windows' built-in usbser driver makes the scanner a COM port |
| Linux, ChromeOS | Web Serial | cdc_acm makes it `/dev/ttyACM0`; you may need to be in the `dialout` group |
| Android | WebUSB | Chrome for Android |

**Scanner ▸ Connect Scanner…** uses the right one for your system, and the menu offers the other
if it doesn't work. Once you've picked the scanner, the browser remembers it: plug it in and it
connects. Only one program or tab can use the scanner at a time; pausing the live bar lets go of it.

Try it without a scanner at **`/?demo`**, which simulates one (scanning, transmissions and all).

## Updates

The app is a PWA: it works offline once loaded, and can be installed. When a new version is
deployed, a yellow note appears at the bottom of the sidebar. **Reload** saves your document and
its undo history, switches to the new version and brings everything back. The note waits while the
scanner is being read or written.

## Developing

```sh
pnpm install
pnpm dev           # http://localhost:5173 (?demo for the simulated scanner)
pnpm test          # the protocol and model library, with 119 tests
pnpm build         # tests, type check, then dist/
pnpm preview       # serve dist/, with the service worker
```

`src/kit` is a TypeScript port of the Mac app's `BC125ATKit`: the model, validation, band plan,
protocol, sync and file formats, with no browser dependencies. Its tests are ports of the Swift
tests, plus checks against the 19,505 frequencies measured on a real scanner and against files
written by the Mac app's own `bc125at-cli`. `src/app` is the React UI. The protocol, as measured on
hardware, is described in the Mac app's `SPEC.md`.

## Deploying to Cloudflare Pages

Connect the repository in the Cloudflare dashboard (**Workers & Pages ▸ Create ▸ Pages ▸ Connect
to Git**) with:

- Framework preset: **None**
- Build command: **`pnpm run build`** (Cloudflare installs with pnpm because of `pnpm-lock.yaml`)
- Build output directory: **`dist`**

Node comes from `.node-version`. `public/_headers` keeps `index.html` and the service worker from
being cached, caches the hashed assets for a year, and allows `usb` and `serial` for the site. The
build ID shown in **Help ▸ Preferences** is the commit Cloudflare built.

## Acknowledgements

The protocol notes start from Uniden's *BC125AT Operation Specification* and were cross-checked
against [bc125py](https://github.com/itsmaxymoo/bc125py) by Max Loiacono (MIT); see `NOTICE`. Not
affiliated with or endorsed by Uniden.

## License

MIT. See `LICENSE`.
