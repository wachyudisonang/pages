/* =====================================================================
 *  debug.js — DEV-ONLY layout tuning tools for the family tree.
 *
 *  NOT part of the live app. Loaded ONLY when the page is opened with the
 *  ?debug flag (see index.html); the live deploy never links or runs it, and
 *  even if it were loaded it no-ops unless window.__ftDebugAPI exists and the
 *  #ft-debug card is present in the DOM.
 *
 *  It reaches the engine ONLY through window.__ftDebugAPI (all live getters,
 *  so it always sees the current focus's values), and registers its cluster
 *  overlay via window.__ftOnRender, which app.js calls at the end of render().
 *  Nothing here computes a layout — it only tunes the shared LAYOUT constants
 *  the engine already reads, and draws boxes from the SAME computed X.
 * ===================================================================== */
(function () {
  "use strict";

  // API is resolved lazily in init() below — NOT captured at parse time, because
  // the load order of app.js (which sets window.__ftDebugAPI) and debug.js is not
  // guaranteed. Capturing it here would run BEFORE app.js and leave API undefined,
  // so the card would render its static HTML but never build the number inputs.
  let API = null;

  // ---- Debug: cluster-boundary overlay --------------------------------------
  // A "cluster" on the key row = a blood/lineage ANCHOR (a placed key-row person who
  // is a child of some union or blood-at that row), plus that anchor's whole subtree
  // (descendant columns) and its same-row spouse. Every placed node is assigned to
  // the cluster whose anchor is its key-row ancestor (walk parents up to KEYGEN); a
  // node with no key-row ancestor (the anchor itself, or an ancestor-row node) is
  // skipped. Boxes are drawn from the SAME X used for the nodes — nothing hardcoded.
  let debugClusters = true;   // cluster-border overlay ON by default

  // The same-row spouse of a person, if placed.
  function spouseOnRowDbg(id, gen, X, UNIONS) {
    for (const u of UNIONS) {
      if (u.a === id && u.b != null && gen[u.b] === gen[id] && X[u.b] != null) return u.b;
      if (u.b === id && gen[u.a] === gen[id] && X[u.a] != null) return u.a;
    }
    return null;
  }

  function drawClusterBoxes() {
    const gen = API.gen, X = API.X, UNIONS = API.UNIONS, P = API.P, KIN = API.KIN;
    const KEY_PERSON = API.KEY_PERSON, stage = API.stage;
    if (!stage) return;
    const KEYGEN = gen[KEY_PERSON];
    if (KEYGEN == null) return;
    const isHidden = API.isHidden, descHidden = API.descHidden;
    const avTop = API.avTop, labelBottom = API.labelBottom;
    // Per-node top/bottom y. In Root (vertical-gen-no-spouse) mode nodes are placed at
    // ROOT_Y (a vertical list), NOT at their generation row, so a box sized from
    // avTop(gen)/labelBottom(gen) collapses to one row's height and cuts off the rest
    // of the list. The seam's nodeTop/nodeBottom resolve the ACTUAL footprint in either
    // mode; fall back to the gen-row Y for an older engine that lacks them.
    const nodeTop    = API.nodeTop    || (id => avTop(gen[id]));
    const nodeBottom = API.nodeBottom || (id => labelBottom(gen[id]));

    const childInModel = id => UNIONS.some(u => (u.children || []).includes(id));
    const isAnchor = id => KIN.isBlood[id]
      || UNIONS.some(u => (u.children || []).includes(id) && [u.a, u.b].some(p => gen[p] != null && gen[p] < KEYGEN))
      || childInModel(id);
    // The key-row anchors, left-to-right, deduping folded-in spouses.
    const anchors = Object.keys(gen)
      .filter(id => gen[id] === KEYGEN && X[id] != null && !isHidden(id) && !descHidden(id) && isAnchor(id))
      .sort((a, b) => X[a] - X[b]);
    const seen = new Set();
    const clusterOfAnchor = [];
    anchors.forEach(a => { if (!seen.has(a)) { seen.add(a); clusterOfAnchor.push(a); const sp = spouseOnRowDbg(a, gen, X, UNIONS); if (sp && !isAnchor(sp)) seen.add(sp); } });
    // Walk a person up to their key-row ancestor (the anchor that owns them).
    const parentUnionOf = pid => UNIONS.find(u => (u.children || []).includes(pid));
    const keyRowOwner = pid => {
      let cur = pid, guard = 0;
      while (cur != null && guard++ < 200) {
        if (gen[cur] === KEYGEN) return cur;
        const pu = parentUnionOf(cur);
        if (!pu) return null;
        // climb the blood/in-model parent that leads back to the key row
        const up = [pu.a, pu.b].filter(Boolean).find(p => gen[p] != null && gen[p] <= KEYGEN);
        cur = up != null ? up : [pu.a, pu.b].filter(Boolean)[0];
      }
      return null;
    };
    // Which key-row owner does each cluster anchor represent? (anchor owns itself + spouse)
    const ownerToCluster = {};
    clusterOfAnchor.forEach((a, i) => { ownerToCluster[a] = i; const sp = spouseOnRowDbg(a, gen, X, UNIONS); if (sp) ownerToCluster[sp] = i; });
    // Collect node boxes per cluster.
    // Node footprint width depends on the render MODE: avatar mode uses NODE_W_AVATAR;
    // name-only mode uses the actual name-box width (NAME_BOX_W content + 2×8 pad +
    // 2×2 border = NAME_BOX_W + 20). Using NODE_W_AVATAR in name-only mode drew every
    // box ~13px too wide per side, so an adjacent Desc box (e.g. 1.3) overshot to the
    // right and appeared to touch its neighbour (1.4) even though the NODES were apart.
    const NODE_W_AVATAR = API.LAYOUT.NODE_W_AVATAR;
    const NODE_W_NAME   = (API.LAYOUT.NAME_BOX_W || 80) + 20;
    const NODE_HALF     = (API.SHOW_AVATAR ? NODE_W_AVATAR : NODE_W_NAME) / 2;
    const boxes = clusterOfAnchor.map(() => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }));
    Object.keys(P).forEach(id => {
      if (X[id] == null || isHidden(id) || descHidden(id)) return;
      let owner = ownerToCluster[id];
      if (owner == null) { const kr = keyRowOwner(id); owner = kr != null ? ownerToCluster[kr] : null; }
      if (owner == null) return;                 // ancestor-row node: not in any cluster
      const b = boxes[owner]; if (!b) return;
      const half = NODE_HALF;
      b.minX = Math.min(b.minX, X[id] - half);
      b.maxX = Math.max(b.maxX, X[id] + half);
      b.minY = Math.min(b.minY, nodeTop(id));
      b.maxY = Math.max(b.maxY, nodeBottom(id));
    });
    const PAD = 8;
    boxes.forEach((b, i) => {
      if (!isFinite(b.minX)) return;
      const box = document.createElement("div");
      box.className = "ft-cluster-box";
      box.style.left = (b.minX - PAD) + "px";
      box.style.top = (b.minY - PAD) + "px";
      box.style.width = (b.maxX - b.minX + PAD * 2) + "px";
      box.style.height = (b.maxY - b.minY + PAD * 2) + "px";
      stage.appendChild(box);
      const tag = document.createElement("div");
      tag.className = "ft-cluster-tag";
      const a = clusterOfAnchor[i];
      tag.textContent = "Cluster " + (i + 1) + ": " + (P[a] ? P[a].lb : a);
      tag.style.left = (b.minX - PAD) + "px";
      tag.style.top = (b.minY - PAD) + "px";
      stage.appendChild(tag);
    });

    // ---- DESCENDANT SUB-CLUSTERS (nested) --------------------------------------
    // The key-row box above wraps a whole key-row family + its ENTIRE subtree as one
    // box. But layoutDesc() actually nests: every descendant PARENT centres its own
    // children block as an independent sub-cluster. Draw one nested box per such
    // parent BELOW the key row (the parent + same-row spouse + all their descendants),
    // so the sub-cluster structure the engine builds is visible. Boxes come from the
    // SAME computed X — nothing hardcoded. Skipped when a parent's descendants are
    // collapsed (nothing nested to show). The key-row anchors themselves are NOT
    // re-boxed here — they already have the outer key-row box.
    const halfSub = NODE_HALF;
    // All ids in the subtree rooted at a person (person + same-row spouse + every
    // descendant across all child-unions), mirroring app.js subtreeIds.
    const subtreeOf = (rootId, acc, seenSet) => {
      if (rootId == null || seenSet.has(rootId)) return acc;
      seenSet.add(rootId); acc.push(rootId);
      const sp = spouseOnRowDbg(rootId, gen, X, UNIONS);
      if (sp != null && !isHidden(sp)) { acc.push(sp); }
      UNIONS.forEach(u => {
        if ((u.a === rootId || u.b === rootId) && u.children && u.children.length) {
          u.children.forEach(k => { if (!isHidden(k) && X[k] != null) subtreeOf(k, acc, seenSet); });
        }
      });
      return acc;
    };
    const hasVisibleChildren = pid => UNIONS.some(u =>
      (u.a === pid || u.b === pid) && (u.children || []).some(k => !isHidden(k) && X[k] != null));
    // The in-model blood parent of a person (the key-side parent of the union they are
    // a child of), or null. Used to decide whether a node is a DIRECT child of the key.
    // (parentUnionOf is already defined above in the key-row cluster block.)
    const isDirectChildOfKey = pid => {
      const pu = parentUnionOf(pid);
      return !!pu && (pu.a === KEY_PERSON || pu.b === KEY_PERSON);
    };
    // The in-model blood parent of pid (the key-side partner of the union pid is a
    // child of), or null. A person "roots a box" if they are the key or a sub-cluster
    // parent (someone with visible children).
    const inModelParentOf = pid => {
      const pu = parentUnionOf(pid);
      if (!pu) return null;
      const a = pu.a, b = pu.b;
      // prefer the blood/in-model partner as the parent
      if (a != null && (a === KEY_PERSON || childInModel(a) || (KIN && KIN.isBlood && KIN.isBlood[a]))) return a;
      if (b != null && (b === KEY_PERSON || childInModel(b) || (KIN && KIN.isBlood && KIN.isBlood[b]))) return b;
      return a != null ? a : b;
    };
    // A descendant ROOTS a Desc sub-cluster box when EITHER:
    //   • it is a deeper descendant that itself has children (a nested sub-family); OR
    //   • it is a CHILDLESS leaf whose in-model parent is the KEY or another
    //     sub-cluster parent (a person with children) — so a childless child at ANY
    //     depth still gets its own numbered box, boxed as itself, exactly like a
    //     childless direct child of the key (the Bagus case), not only at depth 1.
    // A childless leaf is boxed once (it has exactly one in-model parent); the
    // married-in spouse is folded into a root's subtree, never boxed on its own.
    const rootsDescBox = id => {
      if (hasVisibleChildren(id)) return true;
      if (isDirectChildOfKey(id)) return true;
      const par = inModelParentOf(id);
      return par != null && (par === KEY_PERSON || hasVisibleChildren(par));
    };
    // ONE root per couple. Both partners of a union pass hasVisibleChildren (they
    // share the children), so iterating every such person boxes each couple TWICE —
    // the spouse's duplicate box overlaps and its number is wasted (that was the
    // 1.b / 1.d skip bug). Take only the BLOOD/in-model parent as the root: the one
    // who descends from the key (a child of some union in the model), or KIN.isBlood.
    // The married-in spouse is folded into that root's subtree via subtreeOf, not
    // boxed on their own.
    const isBloodDesc = id => (KIN && KIN.isBlood && KIN.isBlood[id]) || childInModel(id);
    const subParents = Object.keys(P)
      .filter(id => X[id] != null && !isHidden(id) && !descHidden(id)
        && gen[id] != null && gen[id] > KEYGEN
        && isBloodDesc(id)                               // blood parent only — not the married-in spouse
        && rootsDescBox(id))                             // direct key-child (even childless) OR a deeper parent
      .sort((a, b) => (gen[a] - gen[b]) || (X[a] - X[b]));
    // Per-depth NUMBER counter: Desc <depth>.<n>, n running 1,2,3,… left-to-right within
    // each depth row — same numeric scheme as the ancestor tags. Numbers (not letters)
    // because a descendant row can hold dozens of families; letters would spill to
    // 'aa, ab, …' and become unreadable. subParents is sorted (gen asc, X asc), so n
    // reads left→right.
    const perDepthCount = {};
    subParents.forEach(pid => {
      const ids = subtreeOf(pid, [], new Set()).filter(id => X[id] != null && !isHidden(id));
      if (!ids.length) return;                           // nothing placed — skip (a lone childless leaf still has ids=[itself])
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      ids.forEach(id => {
        minX = Math.min(minX, X[id] - halfSub);
        maxX = Math.max(maxX, X[id] + halfSub);
        minY = Math.min(minY, nodeTop(id));
        maxY = Math.max(maxY, nodeBottom(id));
      });
      if (!isFinite(minX)) return;
      const depth = gen[pid] - KEYGEN;                   // 1 = key's children row, 2 = grandchildren, …
      const seq = (perDepthCount[depth] || 0) + 1;       // 1-based position within this depth row
      perDepthCount[depth] = seq;
      const SUBPAD = 4;                                  // tighter than the outer PAD so nested boxes sit inside
      const box = document.createElement("div");
      box.className = "ft-cluster-box ft-cluster-box-sub";
      box.style.left = (minX - SUBPAD) + "px";
      box.style.top = (minY - SUBPAD) + "px";
      box.style.width = (maxX - minX + SUBPAD * 2) + "px";
      box.style.height = (maxY - minY + SUBPAD * 2) + "px";
      stage.appendChild(box);
      const tag = document.createElement("div");
      tag.className = "ft-cluster-tag ft-cluster-tag-sub";
      tag.textContent = "Desc " + depth + "." + seq + ": " + (P[pid] ? P[pid].lb : pid);
      tag.style.left = (minX - SUBPAD) + "px";
      tag.style.top = (minY - SUBPAD) + "px";        // TOP-LEFT, like Cluster/Ancestor tags (the .ft-cluster-tag translate(0,-100%) lifts it just above the box edge, clear of the parent node)
      stage.appendChild(tag);
    });
    // Every row ABOVE the key row is a spine of blood ancestors, each possibly
    // polygamous (several same-row spouses). The engine spaces those co-spouse
    // groups with the same FAMILY_GAP_X, so we box them too. For each ancestor
    // generation, group its placed nodes into family units: a blood/in-model
    // anchor on that row plus its same-row spouses, and box each group. Drawn in a
    // muted accent so ancestor clusters read as secondary to the key-row ones.
    const half2 = NODE_HALF;
    // ancestor generations present, from just above the key row upward
    const ancGens = [...new Set(
      Object.keys(gen)
        .filter(id => X[id] != null && !isHidden(id) && gen[id] != null && gen[id] < KEYGEN)
        .map(id => gen[id])
    )].sort((a, b) => b - a);   // nearest ancestor row first (KEYGEN-1, then up)

    let genNum = 0;                    // 1 = focus's parents' row, 2 = grandparents', …
    ancGens.forEach(g => {
      genNum++;                        // ancGens is nearest-to-key first, so this counts up the tree
      // placed nodes on this ancestor row, left-to-right
      const rowIds = Object.keys(gen)
        .filter(id => gen[id] === g && X[id] != null && !isHidden(id))
        .sort((a, b) => X[a] - X[b]);
      // Group by SPOUSE-PAIR, not by "all same-row partners":
      //   • a blood/anchor person + their PRIMARY (first-married) same-row spouse = one box
      //   • each ADDITIONAL co-wife/co-husband = her/his OWN box
      //   • a non-polygamous couple or a lone node = one box (unchanged)
      // Marriage order matches the engine: unions sorted by their oldest child's birth.
      const grouped = new Set();
      const units = [];
      const kidYear = c => (P[c] && Number.isFinite(P[c].order)) ? P[c].order : Infinity;
      // same-row spouses of a person, in marriage-sequence order (unions by oldest child)
      const orderedSpousesOnRow = id => {
        const seq = UNIONS
          .filter(u => (u.a === id || u.b === id))
          .sort((a, b) => {
            const va = (a.children && a.children.length) ? Math.min(...a.children.map(kidYear)) : Infinity;
            const vb = (b.children && b.children.length) ? Math.min(...b.children.map(kidYear)) : Infinity;
            return va - vb;
          })
          .map(u => (u.a === id ? u.b : u.a))
          .filter(p => p != null && gen[p] === g && X[p] != null && !isHidden(p));
        return [...new Set(seq)];
      };
      // How many same-row spouses does a person have? (2+ = polygamous shared parent)
      const sameRowSpouseCount = id => orderedSpousesOnRow(id).length;
      rowIds.forEach(id => {
        if (grouped.has(id)) return;
        const spouses = orderedSpousesOnRow(id);
        // A shared parent married to 2+ same-row spouses: keep this person + PRIMARY
        // (first-married) spouse together; each additional co-spouse becomes own box.
        if (spouses.length >= 2) {
          const primary = spouses.find(s => !grouped.has(s));
          const unit = [id]; grouped.add(id);
          if (primary != null) { unit.push(primary); grouped.add(primary); }
          units.push({ ids: unit, anchor: id });
          return;
        }
        // Plain case: this person + their single same-row spouse (if any) = one box.
        // If that spouse is itself polygamous (the shared parent), DON'T swallow them
        // here — let the shared parent claim its own primary. Otherwise fold the couple.
        const sp = spouses[0];
        if (sp != null && !grouped.has(sp) && sameRowSpouseCount(sp) < 2) {
          units.push({ ids: [id, sp], anchor: (KIN.isBlood[id] || childInModel(id)) ? id : sp });
          grouped.add(id); grouped.add(sp);
        } else {
          units.push({ ids: [id], anchor: id });
          grouped.add(id);
        }
      });

      // Number the couples within THIS generation left-to-right: 1.1, 1.2, 1.3 …
      // (sort by the unit's leftmost node so the numbers read left→right on screen).
      units.sort((u1, u2) => {
        const x1 = Math.min(...u1.ids.map(id => X[id]));
        const x2 = Math.min(...u2.ids.map(id => X[id]));
        return x1 - x2;
      });
      units.forEach((u, ui) => {
        let minX = Infinity, maxX = -Infinity;
        u.ids.forEach(id => { minX = Math.min(minX, X[id] - half2); maxX = Math.max(maxX, X[id] + half2); });
        if (!isFinite(minX)) return;
        const minY = avTop(g), maxY = labelBottom(g);
        const box = document.createElement("div");
        box.className = "ft-cluster-box ft-cluster-box-anc";
        box.style.left = (minX - PAD) + "px";
        box.style.top = (minY - PAD) + "px";
        box.style.width = (maxX - minX + PAD * 2) + "px";
        box.style.height = (maxY - minY + PAD * 2) + "px";
        stage.appendChild(box);
        const tag = document.createElement("div");
        tag.className = "ft-cluster-tag ft-cluster-tag-anc";
        const seq = ui + 1;                             // 1, 2, 3, … left-to-right (numbers, matching sub-clusters)
        const a = u.anchor;
        tag.textContent = "Asc " + genNum + "." + seq + ": " + (P[a] ? P[a].lb : a);
        tag.style.left = (minX - PAD) + "px";
        tag.style.top = (minY - PAD) + "px";
        stage.appendChild(tag);
      });
    });
  }

  // Registered with app.js — fires at the end of every render().
  window.__ftOnRender = function () {
    if (debugClusters) drawClusterBoxes();
    syncAvatarDependentFields();
  };

  // Each of these constants drives layout in only ONE avatar mode, so its debug field
  // is hidden in the other mode where editing it would do nothing:
  //   • AVATAR_DIAMETER (avatar diameter / node height) + NODE_W_AVATAR (node width) → hidden when avatars OFF
  //     (name-only mode derives its box from NAME_BOX_H / NAME_BOX_W instead)
  //   • NAME_BOX_H / NAME_BOX_W (name-box size) → hidden when avatars ON
  function syncAvatarDependentFields() {
    const setVis = (k, showWhenAvatar) => {
      const row = document.querySelector('#ft-debug [data-dbg-row="' + k + '"]');
      if (row) row.style.display = (API.SHOW_AVATAR === showWhenAvatar) ? "" : "none";
    };
    setVis("AVATAR_DIAMETER", true);                     // avatar-only: show only when avatars ON
    setVis("NODE_W_AVATAR", true);                  // avatar-only: show only when avatars ON
    setVis("NAME_BOX_H", false);             // name-only: show only when avatars OFF
    setVis("NAME_BOX_W", false);
  }

  // ---- Debug card: live-edit every LAYOUT constant --------------------------
  // One number input per key in LAYOUT_DEFAULTS. Editing a field writes LAYOUT[key]
  // and re-renders (render() calls syncLayout() first). "Reset defaults" restores
  // LAYOUT from LAYOUT_DEFAULTS. Nothing here is hardcoded per-node — it only tunes
  // the shared spacing/size constants the layout algorithm already reads.
  const DEBUG_META = {
    AVATAR_DIAMETER:    { label: "Avatar diameter",   unit: "px" },
    NODE_W_AVATAR:      { label: "Node width (avatar)", unit: "px" },
    NAME_BOX_H:         { label: "Name box height",   unit: "px" },
    NAME_BOX_W:         { label: "Name box width",    unit: "px" },
    SIBLING_PITCH_X:    { label: "Sibling pitch",     unit: "px" },
    SPOUSE_PITCH_X:     { label: "Spouse pitch",      unit: "px" },
    FAMILY_GAP_X:       { label: "Family gap",        unit: "px" },
    SUBFAMILY_GAP_X:    { label: "Sub-family gap",    unit: "px" },
    INLAW_GAP_X:        { label: "In-law gap",        unit: "px" },
    GENERATION_PITCH_Y: { label: "Generation pitch",  unit: "px" },
    CANVAS_PAD_TOP:     { label: "Top padding",       unit: "px" },
    CAPTION_H:          { label: "Caption height",    unit: "px" },
    CANVAS_PAD_X:       { label: "Side padding",      unit: "px" },
    BUS_CLEARANCE:      { label: "Bus clearance",     unit: "px" },
    CANVAS_PAD_BOTTOM:  { label: "Bottom padding",    unit: "px" },
  };
  function buildDebugCard() {
    const LAYOUT = API.LAYOUT, LAYOUT_DEFAULTS = API.LAYOUT_DEFAULTS;
    const wrap = document.getElementById("ft-debug-fields");
    if (!wrap) return;
    wrap.innerHTML = Object.keys(LAYOUT_DEFAULTS).map(key => {
      const m = DEBUG_META[key] || { label: key, unit: "" };
      return '<div class="ft-dbg-row" data-dbg-row="' + key + '">' +
        '<label class="ft-dbg-label" for="ft-dbg-' + key + '" title="' + key + '">' +
          m.label + ' <code class="ft-dbg-key">' + key + '</code>' +
        '</label>' +
        '<input type="number" id="ft-dbg-' + key + '" data-key="' + key + '" ' +
          'step="1" value="' + LAYOUT[key] + '">' +
      '</div>';
    }).join("");
    // Apply on input — write LAYOUT[key] and redraw live.
    wrap.querySelectorAll("input[type=number]").forEach(inp => {
      inp.addEventListener("input", () => {
        const key = inp.getAttribute("data-key");
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v)) return;   // ignore empty / mid-typing
        LAYOUT[key] = v;
        API.render();
      });
    });
    syncAvatarDependentFields();   // set NAME_BOX_H row visibility for the current avatar state
  }
  function refreshDebugValues() {
    const LAYOUT = API.LAYOUT, LAYOUT_DEFAULTS = API.LAYOUT_DEFAULTS;
    Object.keys(LAYOUT_DEFAULTS).forEach(key => {
      const inp = document.getElementById("ft-dbg-" + key);
      if (inp && document.activeElement !== inp) inp.value = LAYOUT[key];
    });
  }
  // Stack the debug card directly below the print card (or the controls card when
  // the print card is absent); heights vary by content.
  function positionDebugCard() {
    const anchor = document.getElementById("ft-print") || document.getElementById("ft-controls");
    const dbg = document.getElementById("ft-debug");
    if (!anchor || !dbg || getComputedStyle(dbg).position !== "fixed") return;
    const r = anchor.getBoundingClientRect();
    dbg.style.top = Math.round(r.bottom + 10) + "px";
  }
  window.__ftPositionDebugCard = positionDebugCard;
  function wireDebugCard() {
    buildDebugCard();
    positionDebugCard();
    const reset = document.getElementById("ft-debug-reset");
    if (reset) reset.addEventListener("click", () => {
      Object.assign(API.LAYOUT, API.MODE_DEFAULTS);   // restore the ACTIVE mode's defaults (name-only tightens a few)
      refreshDebugValues();
      API.render();
    });
    const clustersChk = document.getElementById("ft-debug-clusters");
    if (clustersChk) {
      clustersChk.checked = debugClusters;   // JS state is authoritative — ignore any browser-restored checked state on reload
      clustersChk.addEventListener("change", () => {
        debugClusters = !!clustersChk.checked;
        API.render();                        // redraw so the overlay hook runs (or clears)
      });
    }
    const toggle = document.getElementById("ft-debug-toggle");
    const card = document.getElementById("ft-debug");
    if (toggle && card) toggle.addEventListener("click", () => {
      const isCollapsed = card.classList.toggle("ft-collapsed");
      toggle.textContent = isCollapsed ? "+" : "\u2212";
    });
    window.addEventListener("resize", positionDebugCard);
  }

  // ---- Self-initialization (race-proof) -------------------------------------
  // Wait for BOTH the engine seam (window.__ftDebugAPI, set synchronously when
  // app.js executes) AND the debug DOM (#ft-debug, injected by index.html under
  // ?debug). Poll briefly rather than depend on app.js calling us back, so load
  // order between app.js and debug.js no longer matters.
  let wired = false;
  function tryInit() {
    if (wired) return true;
    const api = window.__ftDebugAPI;
    const dom = document.getElementById("ft-debug");
    if (!api || !dom) return false;                  // not ready yet
    API = api;                                       // resolve the seam now
    wired = true;
    wireDebugCard();
    // app.js calls this after a mode toggle: re-read the (re-seeded) LAYOUT values
    // into the inputs and re-apply which fields show for the new avatar mode.
    window.__ftRefreshDebug = function () {
      if (typeof refreshDebugValues === "function") refreshDebugValues();
      syncAvatarDependentFields();
    };
    // If the engine already rendered before we wired, sync the fields once and
    // redraw so the ON-by-default cluster overlay paints on this first load.
    if (typeof refreshDebugValues === "function") refreshDebugValues();
    if (debugClusters && API && typeof API.render === "function") API.render();
    return true;
  }

  // app.js also calls this once after its first render (if it runs after us).
  window.__ftInitDebug = tryInit;

  if (!tryInit()) {
    // Not ready at parse time — poll on a short interval and on DOM ready,
    // giving up after ~5s (the flag was set but the engine never appeared).
    let tries = 0;
    const timer = setInterval(() => {
      if (tryInit() || ++tries > 100) clearInterval(timer);
    }, 50);
    document.addEventListener("DOMContentLoaded", tryInit);
    window.addEventListener("load", tryInit);
  }
})();
