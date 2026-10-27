#!/usr/bin/env bash
#
# deploy.sh — publish web assets from the private project repos into this
# public `pages` hub. ASSETS ONLY: an explicit per-project allow-list, so docs,
# drafts, dev tooling and source never leak into the public repo.
#
# Usage:
#   ./deploy.sh                     # deploy all projects
#   ./deploy.sh masak-apa           # deploy one project
#   ./deploy.sh --dry-run           # PREVIEW all — builds/rsync/stamps simulated, nothing written
#   ./deploy.sh --dry-run familytree  # preview one (flag works in either position; -n is an alias)
#
# After running, review `git status`, then commit + push the `pages` repo:
#   git add -A && git commit -m "Deploy <project> web assets" && git push origin main
#
# Layout assumption: this repo (pages) sits beside the project repos, e.g.
#   BIG_OWN/pages/         <- here
#   BIG_OWN/masak-apa/
#   BIG_OWN/familytree/
#   BIG_OWN/sentralingua-v2/
#
set -euo pipefail

# Resolve this script's own dir (the pages repo root) and the parent (BIG_OWN).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIG_OWN="$(cd "$HERE/.." && pwd)"

# --dry-run: preview everything (builds, rsync, stamps) WITHOUT writing a single file. Accepted in
# any position (./deploy.sh --dry-run familytree  OR  ./deploy.sh familytree --dry-run). The flag is
# stripped out of the args; whatever non-flag token remains is the TARGET (default "all").
DRY_RUN=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --dry-run|-n) DRY_RUN=1 ;;
    *) ARGS+=("$a") ;;
  esac
done
set -- "${ARGS[@]:-}"
if [[ "$DRY_RUN" == 1 ]]; then echo "### DRY RUN — no files will be written (rsync -n, builds/stamps simulated) ###"; echo; fi

# run <cmd...> — execute a write command, or in dry-run just print it. Used for the rsync itself and
# the familytree build/icon subshell, so a dry-run shows the exact action without performing it.
run() {
  if [[ "$DRY_RUN" == 1 ]]; then echo "   [dry-run] would run: $*"; else "$@"; fi
}

# One cache-bust stamp per deploy run (YYYYMMDDHHMM), shared by all stamped projects.
DEPLOY_STAMP="$(date +%Y%m%d%H%M)"

rsync_project() {
  local name="$1" src="$2"; shift 2
  local dest="$HERE/$name"
  if [[ ! -d "$src" ]]; then
    echo "!! skip $name — source not found: $src"
    return 0
  fi
  echo "==> $name  ($src  ->  pages/$name/)"
  run mkdir -p "$dest"
  # Build --include args from the allow-list, exclude everything else.
  local args=()
  for f in "$@"; do args+=(--include="$f"); done
  # --delete-excluded (not just --delete): an rsync --exclude pattern normally PROTECTS matching
  # dest files from deletion, so a file dropped from the allow-list (e.g. familytree's old
  # debug.js/styles.css from the pre-bundle web/ deploy) would linger forever. --delete-excluded
  # makes the allow-list authoritative — the dest ends up as EXACTLY the listed files, nothing stale.
  # In dry-run, rsync's own -n lists what WOULD transfer/delete, changing nothing.
  local dry=(); [[ "$DRY_RUN" == 1 ]] && dry=(-n -v)
  rsync -a --delete --delete-excluded ${dry[@]+"${dry[@]}"} "${args[@]}" --exclude='*' "$src"/ "$dest"/
  if [[ "$DRY_RUN" != 1 ]]; then echo "   files: $(find "$dest" -type f | wc -l | tr -d ' ')"; fi
}

# stamp_version <project> — bake a deploy timestamp into a single-file app so every
# deploy changes the served bytes (new ETag -> browser refetches) AND the hub link
# carries ?v=<stamp> (so hub click-throughs bust too). Runs AFTER rsync, because
# rsync --delete overwrites the deployed copy from the clean source each time.
# macOS/BSD sed (-i '') is used; the source file is never touched, only pages/<p>/.
stamp_version() {
  local name="$1" ver="$2"
  if [[ "$DRY_RUN" == 1 ]]; then echo "   [dry-run] would stamp v=$ver (meta in pages/$name/index.html + hub link)"; return 0; fi
  local file="$HERE/$name/index.html"
  [[ -f "$file" ]] || { echo "   !! stamp skipped — $file missing"; return 0; }
  # 1) Inject/replace a version meta right after the <title> in the DEPLOYED copy.
  if grep -q 'name="app-version"' "$file"; then
    sed -i '' -E "s|<meta name=\"app-version\" content=\"[^\"]*\" />|<meta name=\"app-version\" content=\"$ver\" />|" "$file"
  else
    # insert after the first </title>
    sed -i '' "s|</title>|</title>\\
<meta name=\"app-version\" content=\"$ver\" />|" "$file"
  fi
  # 2) Point the hub card's link at the current version (idempotent: bare or ?v=…).
  local hub="$HERE/index.html"
  sed -i '' -E "s|href=\"\./$name/(\?v=[0-9]+)?\"|href=\"./$name/?v=$ver\"|" "$hub"
  echo "   stamped v=$ver (meta in pages/$name/index.html + hub link)"
}

# stamp_asset <file> <asset-ref> <ver> — append/refresh ?v=<ver> on one LOCAL asset
# reference inside a deployed file. Works for href="…", src="…", url("…"), and
# fetch('…') forms. Idempotent: an existing ?v=NNN is replaced, a bare ref gets one.
# <asset-ref> is the bare path exactly as it appears (e.g. style.css, app.js,
# assets/img/logo.png, assets/js/typed.umd.js, recipes.json). Only matches the
# local path, never an absolute http(s):// URL (those are external, left alone).
stamp_asset() {
  local file="$1" ref="$2" ver="$3"
  if [[ "$DRY_RUN" == 1 ]]; then echo "   [dry-run] would version $ref?v=$ver in $(basename "$file")"; return 0; fi
  [[ -f "$file" ]] || { echo "   !! asset-stamp skipped — $file missing"; return 0; }
  # Escape regex metachars in the ref (., /) for a safe match.
  local esc; esc="$(printf '%s' "$ref" | sed -e 's/[.[\*^$/]/\\&/g')"
  # Replace an existing ?v=NNN on this exact ref, else append ?v=ver.
  # Guard: the char before the ref must be a quote or paren (so we match a real
  # reference, not a substring), and we never touch a ref preceded by // (http(s)).
  sed -i '' -E \
    -e "s@([\"'(])${esc}\?v=[0-9]+@\1${ref}?v=${ver}@g" \
    -e "s@([\"'(])${esc}([\"')])@\1${ref}?v=${ver}\2@g" \
    "$file"
}

deploy_masak_apa() {
  rsync_project masak-apa "$BIG_OWN/masak-apa/web" \
    index.html style.css app.js firebase-sync.js firebase-config.js \
    manifest.json recipes.json
  # Cache-bust: meta + hub link, then version every LOCAL asset ref so a stale
  # app.js/style.css/recipes.json can't be served from the browser cache.
  stamp_version masak-apa "$DEPLOY_STAMP"
  local d="$HERE/masak-apa"
  stamp_asset "$d/index.html" style.css          "$DEPLOY_STAMP"
  stamp_asset "$d/index.html" firebase-config.js "$DEPLOY_STAMP"
  stamp_asset "$d/index.html" firebase-sync.js   "$DEPLOY_STAMP"
  stamp_asset "$d/index.html" app.js             "$DEPLOY_STAMP"
  # recipes.json is fetched from inside app.js, not referenced in the HTML.
  stamp_asset "$d/app.js"     recipes.json        "$DEPLOY_STAMP"
  echo "   assets versioned: style.css, firebase-*.js, app.js, recipes.json"
}

deploy_familytree() {
  # familytree is a MODULAR ES-module engine (source/), NOT a flat app. The dev vhost serves source/
  # raw; the PUBLIC hub must NOT leak source/ (pages/README.md), so we ship a MINIFIED BUNDLE instead:
  # tools/build.js esbuilds source/main.js -> dist/{app.js,style.css,index.html,manifest.json}, and
  # tools/make-icons.js writes real 192/512 PNGs into dist/. We then rsync dist/ as a self-contained
  # grocery-shaped app. source/, tools/, docs/ never reach the hub.
  local ftsrc="$BIG_OWN/familytree"
  if [[ ! -d "$ftsrc/source" ]]; then
    echo "!! skip familytree — source not found: $ftsrc/source"
    return 0
  fi
  echo "==> familytree  (building dist/ from source/ via esbuild)"
  run bash -c "cd '$ftsrc' && node tools/build.js && node tools/make-icons.js"
  # Publish ONLY the self-contained bundle output (same file set as grocery) + the shell service worker.
  # The file lists come from the familytree repo itself (tools/publish-files.js — ONE definition shared
  # with the service-worker precache and the dist verifier, and gate-checked against the built
  # index.html), so adding a file or an icon there never needs a second edit in this repo.
  local pubfiles stampfiles
  pubfiles="$(node "$ftsrc/tools/publish-files.js" files)"
  stampfiles="$(node "$ftsrc/tools/publish-files.js" stamp)"
  if [[ -z "$pubfiles" || -z "$stampfiles" ]]; then
    echo "!! familytree publish list is empty (tools/publish-files.js) — refusing to deploy"
    return 1
  fi
  rsync_project familytree "$ftsrc/dist" $pubfiles
  # Cache-bust: meta + hub link, then version every LOCAL asset ref so a stale app.js/style.css/icon
  # can't be served from the browser cache. (The gstatic Firebase SDK URL inside app.js is external
  # and never stamped — stamp_asset only touches quoted/paren'd local refs, never http(s):// URLs.)
  if [[ -f "$HERE/familytree/index.html" ]]; then
    stamp_version familytree "$DEPLOY_STAMP"
    local d="$HERE/familytree"
    local asset
    for asset in $stampfiles; do
      stamp_asset "$d/index.html" "$asset" "$DEPLOY_STAMP"
    done
    echo "   assets versioned: ${stampfiles// /, } (sw.js cache keyed off the app-version meta)"
  fi
}

deploy_sentralingua_v2() {
  # sentralingua serves from repo root; publish only the canonical index.html + assets/,
  # NOT the index-vN.html drafts or the *.md rationale docs.
  # (No per-folder .nojekyll needed — the root pages/.nojekyll covers the whole site.)
  rsync_project sentralingua-v2 "$BIG_OWN/sentralingua-v2" \
    index.html 'assets/' 'assets/**'
  # Cache-bust: meta + hub link, then version LOCAL assets/ refs only (the many
  # https://sentralingua.com/… images are external and intentionally left alone).
  stamp_version sentralingua-v2 "$DEPLOY_STAMP"
  local d="$HERE/sentralingua-v2"
  stamp_asset "$d/index.html" assets/js/typed.umd.js "$DEPLOY_STAMP"
  stamp_asset "$d/index.html" assets/img/logo.png    "$DEPLOY_STAMP"
  stamp_asset "$d/index.html" assets/img/hero-bg.webp "$DEPLOY_STAMP"
  echo "   assets versioned: typed.umd.js, logo.png, hero-bg.webp"
}

deploy_grocery() {
  # grocery serves from repo root; multi-file app (index.html + style.css + app.js +
  # manifest.json + icon.png 192 + icon-512.png 512). NOT README.md / .gitignore / .kiro.
  rsync_project grocery "$BIG_OWN/grocery" \
    index.html style.css app.js manifest.json icon.png icon-512.png sw.js
  # Cache-bust: meta + hub link, then version every LOCAL asset ref so a stale
  # style.css/app.js/icon.png can't be served from the browser cache.
  stamp_version grocery "$DEPLOY_STAMP"
  local d="$HERE/grocery"
  stamp_asset "$d/index.html" style.css "$DEPLOY_STAMP"
  stamp_asset "$d/index.html" app.js    "$DEPLOY_STAMP"
  stamp_asset "$d/index.html" icon.png  "$DEPLOY_STAMP"
  echo "   assets versioned: style.css, app.js, icon.png"
}

TARGET="${1:-all}"
case "$TARGET" in
  masak-apa)        deploy_masak_apa ;;
  familytree)       deploy_familytree ;;
  sentralingua-v2)  deploy_sentralingua_v2 ;;
  grocery)          deploy_grocery ;;
  all)
    deploy_masak_apa
    deploy_familytree
    deploy_sentralingua_v2
    deploy_grocery
    ;;
  *) echo "unknown project: $TARGET (use: masak-apa | familytree | sentralingua-v2 | grocery | all)"; exit 1 ;;
esac

echo
if [[ "$DRY_RUN" == 1 ]]; then
  echo "### DRY RUN complete — nothing was written. Re-run without --dry-run to apply. ###"
else
  echo "Done. Review changes, then in $HERE:"
  echo "  git add -A && git commit -m \"Deploy $TARGET web assets\" && git push origin main"
fi
