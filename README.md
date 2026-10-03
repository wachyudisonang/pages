# pages — public hosting hub

Public GitHub-Pages repo that serves the **web assets only** of several
private personal projects. Each project keeps its source **and docs** private in
its own repo (`BIG_OWN/<project>`); only the runtime assets are copied here.

## URLs

- Landing: `https://wachyudisonang.github.io/pages/`
- `https://wachyudisonang.github.io/pages/familytree/`
- `https://wachyudisonang.github.io/pages/masak-apa/`
- `https://wachyudisonang.github.io/pages/sentralingua-v2/`
- `https://wachyudisonang.github.io/pages/grocery/`

## What lives here

```
pages/
├── index.html          landing page (cards to each site)
├── .nojekyll           serve files as-is, no Jekyll
├── familytree/         web assets only (rsync'd from BIG_OWN/familytree/web)
├── masak-apa/          web assets only (rsync'd from BIG_OWN/masak-apa/web)
├── sentralingua-v2/    web assets only (rsync'd from BIG_OWN/sentralingua-v2)
└── grocery/            web assets only (rsync'd from BIG_OWN/grocery — single index.html)
```

## What must NEVER be copied here

This repo is **public**. The private source repos hold docs, drafts, dev tooling,
and rationale that stay private. Publishing uses an explicit **allow-list** per
project (not an exclude-list), so a new dev file added upstream is never leaked
by accident. Never copied: `*.md`, `node_modules/`, `.git/`, `source/`, `tools/`,
`print/`, and any `index-vN.html` drafts.

## How to publish (deploy)

Assets are pushed here by a deploy script that rsyncs each project's allow-list
into `pages/<project>/`. Run it from each private repo, then commit + push this
`pages` repo. (Nothing here is hand-edited except `index.html` and this README.)

### Cache-busting (auto-stamp)

GitHub Pages serves with `cache-control: max-age=600`, so a browser (and a
phone's "Add to Home Screen" copy) can keep showing a stale page for up to 10
minutes — longer if the device cache is sticky. To defeat this, `deploy.sh`
computes one timestamp per run (`DEPLOY_STAMP=YYYYMMDDHHMM`) and, for a stamped
project, injects it in two places **after** the rsync (rsync `--delete`
overwrites the deployed copy from clean source each time, so stamping must come
last):

1. a `<meta name="app-version" content="<stamp>">` line in the **deployed**
   `pages/<project>/index.html` — this changes the served bytes, so the ETag
   changes and the browser refetches (and reaches a home-screen shortcut that
   never passes through the hub);
2. the hub card link → `./<project>/?v=<stamp>` (idempotent; replaces any prior
   `?v=`), so hub click-throughs also bust;
3. for multi-file apps, a `?v=<stamp>` appended to every **local** asset
   reference (`<script src>`, `<link href>`, CSS `url(...)`, and `fetch('…')`
   calls inside the JS), so a stale `app.js` / `style.css` / `recipes.json` /
   image can't be served from cache either. **External** `http(s)://` URLs are
   never touched.

The project **source** files are never modified — the version is a deploy
artifact only, applied to the copy in `pages/` after rsync. All runs are
idempotent (an existing `?v=` is replaced, never duplicated).

Per-project local assets that get versioned:
- **grocery** — single-file, meta only (everything inlined).
- **masak-apa** — `style.css`, `firebase-config.js`, `firebase-sync.js`,
  `app.js`, and `recipes.json` (fetched from inside `app.js`). `manifest.json`
  is left bare on purpose.
- **sentralingua-v2** — `assets/js/typed.umd.js`, `assets/img/logo.png`,
  `assets/img/hero-bg.webp` (the `sentralingua.com` images are external).
- **familytree** — `styles.css`, `app.js`, `debug.js` (stamped only when
  actually deployed).

Confirm what's live with:
`curl -s https://wachyudisonang.github.io/pages/grocery/ | grep app-version`.
