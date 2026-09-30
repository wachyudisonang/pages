# pages — public hosting hub

Public GitHub-Pages repo that serves the **web assets only** of several
private personal projects. Each project keeps its source **and docs** private in
its own repo (`BIG_OWN/<project>`); only the runtime assets are copied here.

## URLs

- Landing: `https://wachyudisonang.github.io/pages/`
- `https://wachyudisonang.github.io/pages/familytree/`
- `https://wachyudisonang.github.io/pages/masak-apa/`
- `https://wachyudisonang.github.io/pages/sentralingua-v2/`

## What lives here

```
pages/
├── index.html          landing page (cards to each site)
├── .nojekyll           serve files as-is, no Jekyll
├── familytree/         web assets only (rsync'd from BIG_OWN/familytree/web)
├── masak-apa/          web assets only (rsync'd from BIG_OWN/masak-apa/web)
└── sentralingua-v2/    web assets only (rsync'd from BIG_OWN/sentralingua-v2)
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
