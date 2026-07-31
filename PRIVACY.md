# Color Picker from Image — Privacy Policy

_Last updated: 2026-08-01_

**Color Picker from Image does not collect your data. The images you open never
leave your device.**

## Data we collect

None from inside the extension. It does not read, transmit, sell, or share the
images you open or the colors you pick. There is no telemetry, no crash
reporting, and no identifiers tied to you.

## What the extension can access, and why

- **Images you open, paste or drop** — decoded and read **in your browser, on a
  local canvas**, only so the picker can show you the pixels and their values.
  Nothing is uploaded anywhere; there is no server side at all.
- **Local storage (`storage` permission)** — used only to keep your pick
  history (up to 50 colors) and your own settings (such as auto-copy). This
  never leaves your device.
- **The active tab, only when you ask (`activeTab` + `scripting`)** — when you
  click "Grab this page" or right-click a picture and choose "Pick color from
  this image", the extension takes a snapshot of the visible tab or reads that
  one image, opens the result in the picker, and forgets the page. It cannot
  see your other tabs and does nothing until you invoke it.
- **A context-menu item (`contextMenus` permission)** — adds the single
  "Pick color from this image" entry to the right-click menu on images.

There are **no host permissions**: the extension cannot read or change
websites on its own, and nothing runs in the background while you browse.

## Network

**The extension itself makes no network requests.** Its code contains no
`fetch`, `XMLHttpRequest`, `sendBeacon`, tracking pixels, or remote scripts —
you can verify this in the open-source code. Every color is computed locally.

There are exactly two moments when your browser opens one of our ordinary web
pages in a tab:

- **Right after you install**, a short welcome page opens explaining where to
  find the extension and how to pin it.
- **Right after you uninstall**, Chrome opens a one-question feedback page
  asking why you removed it. Answering is entirely optional.

Those are normal web pages. Like most websites they may count anonymous page
views so we know how many people installed or removed the extension. They do
not receive any of your images, browsing history, or personal information.

## Contact

Questions about this policy: **hello@zumelia.com**
