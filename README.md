# Color Picker from Image

Open a picture — a screenshot, a logo, a photo — and take the exact color out
of it. **Local, open source. No ads, no accounts, no telemetry.**

Built against the recorded pains of this niche's incumbents: clipboard copies
that silently fail, values that vanish after two seconds, "SHADY PERMISSIONS"
warnings, ads, and pickers that read a blurry re-render instead of the file.
This is the boring, trustworthy version.

## What it does

- **Open an image** any way you like: file dialog, drag & drop, or **Ctrl+V**
  straight from the clipboard. PNG, JPG, WebP, GIF, SVG, AVIF.
- **Zoom loupe** with a pixel grid, reading the file at native resolution.
- **Keyboard precision**: arrows move the picker exactly 1 px, Ctrl+arrows
  jump 10 px, Enter picks.
- **HEX, RGB and HSL** shown together; auto-copy on pick with visible
  confirmation. The panel stays open — values never vanish.
- **Palette** of dominant colors — each swatch is a real color from the image,
  never an averaged shade that exists nowhere in it.
- **50-color history** that survives browser restarts; visible in the popup,
  cleared with one click.
- **Grab this page as an image**: one click captures the visible tab into the
  picker. Right-click any picture → "Pick color from this image" — with an
  honest fallback ladder (true pixels → rendered snapshot → a plain hint),
  never a silent failure.

## Privacy — the whole point

- **Zero network.** No `fetch`, no XHR, no beacons. Your images never leave
  the tab. Grep the source and confirm.
- **Permissions:** `storage` (history + settings), `activeTab` + `scripting` +
  `contextMenus` (only to capture/read the page **you** explicitly invoke it
  on). **No host permissions** — the install shows no warnings.
- Nothing runs in the background: code executes only while the picker tab or
  popup is open.

See [PRIVACY.md](PRIVACY.md).

## Repository layout

    core/core.js          color math, pixel reading, palette, history — the
                          single source of truth, tested in plain Node
    extension-chrome/     the MV3 extension (src/core.js is a generated copy —
                          refresh with `npm run sync`)
    test/                 node + jsdom tests, no build step
    scripts/              sync-core.sh, build-chrome.sh (store zip)

## Development

    npm install           # jsdom for the popup/service-worker tests
    npm test              # core + sync + popup + background suites
    npm run sync          # refresh the generated copy of the engine
    ./scripts/build-chrome.sh   # build the store zip

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked →
select `extension-chrome/`.

## License

[MIT](LICENSE) © Zumelia
