# OpenLiteraReader — file map

`index.html` now loads CSS and JS as small, focused files instead of one
giant block. They're plain `<link>`/`<script src>` tags (not ES modules),
so every file shares one global scope — exactly like the original
single-file version — and **load order matters**, which is why the
filenames are numbered.

**This needs a real web server to run.** Opening `index.html` straight
from a phone's Downloads folder generally won't load the linked files —
that's a browser security restriction on local files (no folder access,
just the one file the OS handed over), not a bug here. Serve the whole
`OpenLiteraReader/` folder over HTTP(S) and it behaves exactly like the
single-file version did. Any of these work:

- `python3 -m http.server` from inside the folder, then open `localhost:8000`
- Any static host: GitHub Pages, Netlify, Vercel, Cloudflare Pages, etc.
- Your own server — it's just static files, nothing to build or install

## Looking for something specific?

| Want to change...                                          | Look in |
|---|---|
| Colours, spacing, the splash/landing screen                 | `css/01-variables-and-landing.css` |
| Top toolbar, the page viewer itself                         | `css/02-hud-and-viewer.css` |
| The "translate this word" patch's look                      | `css/03-quick-translate.css` |
| Thumbnail sidebar, settings sheet look                      | `css/04-sidebar-and-sheet.css` |
| Side-by-side translation view, spread/chapter marks         | `css/05-bilingual-view.css` |
| Zoom controls, table of contents, desktop layout             | `css/06-panels-and-desktop.css` |
| Full-page translation overlay, wordmark, light mode          | `css/07-overlay-and-themes.css` |
| App state, PDF.js setup                                     | `js/01-core-setup.js` |
| Opening a file, rendering pages, dark-mode colours            | `js/02-file-open-and-pages.js` |
| Zoom (buttons/pinch/wheel/double-tap), tap-to-hide-HUD         | `js/03-zoom-and-touch.js` |
| "Select text" drag-select mode, the Copy button                | `js/04-select-mode.js` |
| Instant translate-on-selection, the back-button fix             | `js/05-quick-translate.js` |
| Thumbnails, scroll progress, page-rail navigation                | `js/06-navigation-and-progress.js` |
| Translation engines (Google/Lingva/MyMemory/on-device)             | `js/07-translation-engines.js` |
| Pulling paragraph text out of a PDF page                            | `js/08-text-extraction.js` |
| Building the side-by-side view, "Translate page", Save               | `js/09-bilingual-view.js` |
| Turning translation on/off, language settings UI                       | `js/10-translation-lifecycle.js` |
| Page layout, spread/rotation, page navigation, zoom UI                   | `js/11-layout-and-view-modes.js` |
| Chapters/TOC, the toolbar title, fullscreen, keyboard shortcuts            | `js/12-sidebar-and-chrome.js` |
| How full-page translations get painted onto the page                        | `js/13-page-overlay-translation.js` |
| Keeping photos in colour in dark mode, the compare view                       | `js/14-images-and-compare-view.js` |
| Your own PDF library shown on the landing page                                 | `books/books.json` (+ the PDFs themselves) |

## Your own library on the landing page

Drop PDFs into the `books/` folder and list them in `books/books.json` —
they'll show up as a tappable shelf under the drop zone, so you don't have
to browse for the same books every time. Two steps per book:

1. Put the PDF in `books/` — e.g. `books/dune.pdf`
2. Add a line to `books/books.json`:

```json
[
  { "file": "dune.pdf", "title": "Dune" },
  { "file": "1984.pdf", "title": "Nineteen Eighty-Four" }
]
```

`title` is optional — leave it out and the filename is used instead.
Redeploy after editing either the PDFs or `books.json`. No books listed
(the default, empty `[]`) means the shelf just doesn't show up — the
landing page looks exactly like it did before this feature existed.

## Adding a new file

Anything referenced from *inside* a function or an event callback can
reference code from a file that loads later — those only ever run after
the whole page (all files) has finished loading, so order doesn't matter
there. It only matters for code that runs immediately at the top level,
outside a function — that can only see things a numerically earlier file
already defined. Keep the numeric prefixes in sequence if you add a file,
so the load order stays obvious at a glance.
