#!/usr/bin/env bash
#
# deploy.sh — publish web assets from the private project repos into this
# public `pages` hub. ASSETS ONLY: an explicit per-project allow-list, so docs,
# drafts, dev tooling and source never leak into the public repo.
#
# Usage:
#   ./deploy.sh            # deploy all projects
#   ./deploy.sh masak-apa  # deploy one project
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
  mkdir -p "$dest"
  # Build --include args from the allow-list, exclude everything else.
  local args=()
  for f in "$@"; do args+=(--include="$f"); done
  rsync -a --delete "${args[@]}" --exclude='*' "$src"/ "$dest"/
  echo "   files: $(find "$dest" -type f | wc -l | tr -d ' ')"
}

# stamp_version <project> — bake a deploy timestamp into a single-file app so every
# deploy changes the served bytes (new ETag -> browser refetches) AND the hub link
# carries ?v=<stamp> (so hub click-throughs bust too). Runs AFTER rsync, because
# rsync --delete overwrites the deployed copy from the clean source each time.
# macOS/BSD sed (-i '') is used; the source file is never touched, only pages/<p>/.
stamp_version() {
  local name="$1" ver="$2"
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

deploy_masak_apa() {
  rsync_project masak-apa "$BIG_OWN/masak-apa/web" \
    index.html style.css app.js firebase-sync.js firebase-config.js \
    manifest.json recipes.json
}

deploy_familytree() {
  # familytree serves from web/; publish only runtime files (NOT source/, tools/, print/, node_modules/).
  rsync_project familytree "$BIG_OWN/familytree/web" \
    index.html styles.css app.js debug.js robots.txt
}

deploy_sentralingua_v2() {
  # sentralingua serves from repo root; publish only the canonical index.html + assets/,
  # NOT the index-vN.html drafts or the *.md rationale docs.
  # (No per-folder .nojekyll needed — the root pages/.nojekyll covers the whole site.)
  rsync_project sentralingua-v2 "$BIG_OWN/sentralingua-v2" \
    index.html 'assets/' 'assets/**'
}

deploy_grocery() {
  # grocery serves from repo root; single-file app — everything (CSS/JS/icons) is inlined
  # in index.html, so index.html is the whole runtime. NOT README.md / .gitignore.
  rsync_project grocery "$BIG_OWN/grocery" \
    index.html
  # Auto cache-bust: single-file app has no external asset to version, so stamp a
  # deploy-time meta into the served file (new bytes -> new ETag) and the hub link.
  stamp_version grocery "$DEPLOY_STAMP"
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
echo "Done. Review changes, then in $HERE:"
echo "  git add -A && git commit -m \"Deploy $TARGET web assets\" && git push origin main"
