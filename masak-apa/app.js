/* Masak Apa Hari Ini? — offline recommendation app (GitHub Pages / IndexedDB)
   Rules:
   - Show up to 10 recommendations.
   - "Masak ini" (chosen)  -> recorded; hidden from recs for 7 days.
   - "Bukan hari ini" (rejected) -> hidden from recs until tomorrow (local day).
   - "Dimasak minggu ini": choices in the last 7 days.
   - Auto-purge history older than 30 days on load.
   All data is per-browser in IndexedDB. Backup/Restore via JSON file.
*/
(function () {
  'use strict';

  var DB_NAME = 'masakApaDB';
  var DB_VERSION = 2;
  var STORE = 'history';   // {id(recipeId), action:'cook'|'skip', ts, dayKey, title, cat}
  var REFS = 'refs';       // {key, name, url, cat, source, inRecs, ts}
  var REC_COUNT = 10;
  var COOK_HIDE_DAYS = 7;
  var PURGE_DAYS = 30;

  var CAT_EMOJI = { Ayam:'🍗', Sapi:'🥩', Kambing:'🐐', Ikan:'🐟', Udang:'🦐', Telur:'🥚', Tahu:'🧊', Tempe:'🟫' };
  var CATS = ['Ayam','Sapi','Kambing','Ikan','Udang','Telur','Tahu','Tempe'];

  var db = null;
  var RECIPES = [];
  var RECIPE_BY_ID = {};
  var REF_BY_RECID = {};   // "ref:<key>" -> recipe-like object (refs opted into recs)
  var CLOUD_REFS = [];     // approved community refs (live from Firebase), recipe-like
  var CLOUD_BY_ID = {};    // "cloud:<key>" -> recipe-like
  var activeCat = 'all';
  var currentRecs = [];   // ids currently shown

  // ---------- day helpers (local time) ----------
  function now() { return Date.now(); }
  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function todayKey() { return dayKey(now()); }
  function daysAgoTs(n) { return now() - n * 86400000; }

  // ---------- IndexedDB ----------
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) {
          var os = d.createObjectStore(STORE, { keyPath: 'key', autoIncrement: true });
          os.createIndex('by_recipe', 'id', { unique: false });
          os.createIndex('by_ts', 'ts', { unique: false });
        }
        if (!d.objectStoreNames.contains(REFS)) {
          d.createObjectStore(REFS, { keyPath: 'key', autoIncrement: true });
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }
  function tx(mode) { return db.transaction(STORE, mode).objectStore(STORE); }
  function getAll() {
    return new Promise(function (resolve, reject) {
      var out = [];
      var req = tx('readonly').openCursor();
      req.onsuccess = function (e) {
        var c = e.target.result;
        if (c) { out.push(c.value); c.continue(); } else { resolve(out); }
      };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }
  function addRecord(rec) {
    return new Promise(function (resolve, reject) {
      var req = tx('readwrite').add(rec);
      req.onsuccess = function () { resolve(); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }
  function purgeOld() {
    return new Promise(function (resolve) {
      var cutoff = daysAgoTs(PURGE_DAYS);
      var store = tx('readwrite');
      var idx = store.index('by_ts');
      var range = IDBKeyRange.upperBound(cutoff);
      var req = idx.openCursor(range);
      var n = 0;
      req.onsuccess = function (e) {
        var c = e.target.result;
        if (c) { c.delete(); n++; c.continue(); } else { resolve(n); }
      };
      req.onerror = function () { resolve(n); };
    });
  }
  function clearAll() {
    return new Promise(function (resolve, reject) {
      var req = tx('readwrite').clear();
      req.onsuccess = function () { resolve(); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  // ---------- refs store ----------
  function refTx(mode) { return db.transaction(REFS, mode).objectStore(REFS); }
  function getAllRefs() {
    return new Promise(function (resolve, reject) {
      if (!db || !db.objectStoreNames.contains(REFS)) { resolve([]); return; }
      var out = [];
      var req = refTx('readonly').openCursor();
      req.onsuccess = function (e) {
        var c = e.target.result;
        if (c) { out.push(c.value); c.continue(); } else { resolve(out); }
      };
      req.onerror = function () { resolve(out); };
    });
  }
  function addRef(rec) {
    return new Promise(function (resolve, reject) {
      var req = refTx('readwrite').add(rec);
      req.onsuccess = function () { resolve(); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }
  function deleteRef(key) {
    return new Promise(function (resolve, reject) {
      var req = refTx('readwrite').delete(key);
      req.onsuccess = function () { resolve(); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }
  function clearRefs() {
    return new Promise(function (resolve) {
      if (!db || !db.objectStoreNames.contains(REFS)) { resolve(); return; }
      var req = refTx('readwrite').clear();
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { resolve(); };
    });
  }

  // ---------- URL / source parsing ----------
  // Detect the source platform from a pasted URL.
  function detectSource(url) {
    var u = String(url).toLowerCase();
    if (/(?:youtube\.com|youtu\.be)/.test(u)) return 'YouTube';
    if (/instagram\.com/.test(u)) return 'Instagram';
    if (/tiktok\.com/.test(u)) return 'TikTok';
    if (/facebook\.com|fb\.watch/.test(u)) return 'Facebook';
    return 'Web';
  }
  var SOURCE_EMOJI = { YouTube:'▶️', Instagram:'📸', TikTok:'🎵', Facebook:'👥', Web:'🔗' };
  // Extract a YouTube video id (watch?v=, youtu.be/, shorts/, embed/).
  function youtubeId(url) {
    var m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  function isValidUrl(url) {
    try { var u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; }
    catch (e) { return false; }
  }
  // A ref participates in recs/history under a string id "ref:<key>" so it never
  // collides with numeric recipe ids.
  function refRecId(ref) { return 'ref:' + ref.key; }

  // ---------- recommendation logic ----------
  // Build set of recipe ids to EXCLUDE from today's recommendations.
  function computeExclusions(history) {
    var cookCutoff = daysAgoTs(COOK_HIDE_DAYS);
    var tk = todayKey();
    var excluded = {};
    history.forEach(function (h) {
      if (h.action === 'cook' && h.ts >= cookCutoff) {
        excluded[h.id] = true;                 // cooked in last 7 days
      } else if (h.action === 'skip' && h.dayKey === tk) {
        excluded[h.id] = true;                 // skipped today only
      }
    });
    return excluded;
  }

  // Deterministic daily shuffle so the 10 recs are stable within a day
  // (until the user acts or taps "Acak ulang"), seeded by day + salt.
  var reshuffleSalt = 0;
  function seededPick(pool, count, seedStr) {
    // xmur3 + mulberry32
    function xmur3(str){ for(var i=0,h=1779033703^str.length;i<str.length;i++){h=Math.imul(h^str.charCodeAt(i),3432918353);h=h<<13|h>>>19;} return function(){h=Math.imul(h^h>>>16,2246822507);h=Math.imul(h^h>>>13,3266489909);return (h^=h>>>16)>>>0;}; }
    function mulberry32(a){ return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;}; }
    var seed = xmur3(seedStr)();
    var rand = mulberry32(seed);
    var arr = pool.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr.slice(0, count);
  }

  function buildRecommendations(history) {
    var excluded = computeExclusions(history);
    var refItems = Object.keys(REF_BY_RECID).map(function (k) { return REF_BY_RECID[k]; });
    var candidates = RECIPES.concat(refItems).concat(CLOUD_REFS);
    var pool = candidates.filter(function (r) {
      if (excluded[r.id]) return false;
      if (activeCat !== 'all' && r.cat !== activeCat) return false;
      return true;
    });
    var seed = todayKey() + '|' + activeCat + '|' + reshuffleSalt;
    var picked = seededPick(pool, REC_COUNT, seed);
    return { picked: picked, poolSize: pool.length };
  }

  // Turn a stored ref into a recipe-like object usable in the rec pool + cards.
  function refToRecipeLike(ref) {
    return {
      id: refRecId(ref),
      title: ref.name,
      cat: ref.cat || 'Lainnya',
      loves: 0,
      ing: [],
      steps: [],
      isRef: true,
      url: ref.url,
      source: ref.source || detectSource(ref.url),
      refKey: ref.key
    };
  }

  // Rebuild REF_BY_RECID from the refs store (only those opted into recs).
  async function refreshRefIndex() {
    REF_BY_RECID = {};
    var refs = await getAllRefs();
    refs.forEach(function (ref) {
      RECIPE_BY_ID[refRecId(ref)] = refToRecipeLike(ref); // so week/report can resolve titles
      if (ref.inRecs) REF_BY_RECID[refRecId(ref)] = RECIPE_BY_ID[refRecId(ref)];
    });
  }

  // ---------- rendering ----------
  var el = function (id) { return document.getElementById(id); };

  function shortPreview(r) {
    return r.ing.slice(0, 4).join(', ');
  }

  function recipeCard(r, opts) {
    opts = opts || {};
    var div = document.createElement('div');
    div.className = 'card' + (opts.weekItem ? ' week-item' : '') + (r.isRef ? ' card-ref' : '');
    var badges = '<span class="badge">' + r.cat + '</span>' +
                 (r.isRef ? '<span class="badge ref-source">' + (SOURCE_EMOJI[r.source]||'🔗') + ' ' + r.source + '</span>'
                          : (r.loves ? '<span class="badge loves">❤ ' + r.loves + '</span>' : ''));
    var actions;
    if (opts.weekItem) {
      actions = '<div class="card-actions"><button class="btn btn-no act-remove">↩️ Batalkan</button></div>';
    } else {
      actions = '<div class="card-actions">' +
        '<button class="btn btn-ok act-cook">✓ Masak ini</button>' +
        '<button class="btn btn-no act-skip">✗ Bukan hari ini</button></div>';
    }
    var preview = r.isRef ? 'Referensi dari ' + r.source : escapeHtml(shortPreview(r));
    var detailLabel = r.isRef ? 'Buka referensi →' : 'Lihat resep lengkap →';
    div.innerHTML =
      '<div class="card-top">' +
        '<span class="card-emoji">' + (r.isRef ? (SOURCE_EMOJI[r.source]||'🔗') : (CAT_EMOJI[r.cat] || '🍽️')) + '</span>' +
        '<div style="flex:1"><div class="card-title">' + escapeHtml(r.title) + '</div>' +
        '<div class="card-badges">' + badges + '</div></div>' +
      '</div>' +
      '<div class="card-preview">' + preview + '</div>' +
      '<button class="link-detail">' + detailLabel + '</button>' +
      actions;
    div.querySelector('.link-detail').addEventListener('click', function () {
      if (r.isRef) openRefModal(r); else openModal(r);
    });
    if (opts.weekItem) {
      div.querySelector('.act-remove').addEventListener('click', function () { removeChoice(r.id); });
    } else {
      div.querySelector('.act-cook').addEventListener('click', function () { choose(r, 'cook'); });
      div.querySelector('.act-skip').addEventListener('click', function () { choose(r, 'skip'); });
    }
    return div;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  async function renderRecs() {
    if (db) { await refreshRefIndex(); }
    var history = await getAll();
    var res = buildRecommendations(history);
    currentRecs = res.picked.map(function (r) { return r.id; });
    var list = el('rec-list');
    list.innerHTML = '';
    if (res.picked.length === 0) {
      el('rec-empty').hidden = false;
      el('rec-info').textContent = '';
    } else {
      el('rec-empty').hidden = true;
      res.picked.forEach(function (r) { list.appendChild(recipeCard(r)); });
      el('rec-info').textContent = 'Menampilkan ' + res.picked.length + ' dari ' + res.poolSize + ' pilihan';
    }
  }

  async function renderWeek() {
    if (db) { await refreshRefIndex(); }
    var history = await getAll();
    var cutoff = daysAgoTs(COOK_HIDE_DAYS);
    // latest cook per recipe within 7 days
    var byId = {};
    history.forEach(function (h) {
      if (h.action === 'cook' && h.ts >= cutoff) {
        if (!byId[h.id] || h.ts > byId[h.id].ts) byId[h.id] = h;
      }
    });
    var items = Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a,b){ return b.ts - a.ts; });
    var list = el('week-list');
    list.innerHTML = '';
    if (items.length === 0) { el('week-empty').hidden = false; return; }
    el('week-empty').hidden = true;
    items.forEach(function (h) {
      // resolve to recipe/ref; fall back to the history record itself (e.g. a deleted ref)
      var r = RECIPE_BY_ID[h.id] || { id: h.id, title: h.title || 'Menu', cat: h.cat || 'Lainnya', loves: 0, ing: [], steps: [], isRef: (typeof h.id === 'string' && h.id.indexOf('ref:') === 0) };
      var card = recipeCard(r, { weekItem: true });
      var when = document.createElement('div');
      when.className = 'muted';
      when.style.fontSize = '.78rem';
      when.textContent = 'Dimasak: ' + new Date(h.ts).toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long' });
      card.insertBefore(when, card.querySelector('.card-actions'));
      list.appendChild(card);
    });
  }

  async function renderStats() {
    var history = await getAll();
    var cooks = history.filter(function (h){ return h.action==='cook'; }).length;
    var skips = history.filter(function (h){ return h.action==='skip'; }).length;
    el('stats-line').textContent =
      RECIPES.length + ' resep tersedia · ' + cooks + ' kali masak dicatat · ' + skips + ' dilewati · ' + history.length + ' total riwayat';
  }

  // ---------- report ----------
  var reportDays = 7;
  var ID_LOCALE = 'id-ID';
  async function renderReport() {
    var history = await getAll();
    var cutoff = daysAgoTs(reportDays);
    // all COOK records within the window (every cooking, including repeats)
    var cooks = history.filter(function (h) { return h.action === 'cook' && h.ts >= cutoff; })
                       .sort(function (a, b) { return b.ts - a.ts; });

    var listEl = el('report-list');
    var summaryEl = el('report-summary');
    var catsEl = el('report-cats');

    if (cooks.length === 0) {
      el('report-empty').hidden = false;
      summaryEl.innerHTML = ''; catsEl.innerHTML = ''; listEl.innerHTML = '';
      return;
    }
    el('report-empty').hidden = true;

    // totals
    var distinct = {};
    var byCat = {};
    var byTitle = {};
    cooks.forEach(function (h) {
      distinct[h.id] = true;
      byCat[h.cat] = (byCat[h.cat] || 0) + 1;
      byTitle[h.title] = (byTitle[h.title] || 0) + 1;
    });
    var distinctCount = Object.keys(distinct).length;
    var topDish = Object.keys(byTitle).sort(function (a, b) { return byTitle[b] - byTitle[a]; })[0];
    var topDishN = byTitle[topDish];

    summaryEl.innerHTML =
      '<div class="report-stats">' +
      '<div class="stat-box"><div class="stat-num">' + cooks.length + '</div><div class="stat-label">kali masak</div></div>' +
      '<div class="stat-box"><div class="stat-num">' + distinctCount + '</div><div class="stat-label">menu berbeda</div></div>' +
      '<div class="stat-box"><div class="stat-num">' + Object.keys(byCat).length + '</div><div class="stat-label">kategori</div></div>' +
      '</div>' +
      (topDishN > 1 ? '<p class="muted">Paling sering: <strong>' + escapeHtml(topDish) + '</strong> (' + topDishN + '×)</p>' : '');

    // category bars
    var maxCat = Math.max.apply(null, Object.keys(byCat).map(function (k){ return byCat[k]; }));
    var catRows = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).map(function (c) {
      var pct = Math.round(byCat[c] / maxCat * 100);
      return '<div class="cat-bar">' +
        '<span class="cat-name">' + (CAT_EMOJI[c] || '') + ' ' + c + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="cat-count">' + byCat[c] + '</span></div>';
    }).join('');
    catsEl.innerHTML = '<h3 style="margin:8px 0;">Per Kategori</h3>' + catRows;

    // detail list grouped by day
    var groups = {};
    cooks.forEach(function (h) {
      (groups[h.dayKey] = groups[h.dayKey] || []).push(h);
    });
    var dayKeys = Object.keys(groups).sort().reverse();
    var html = '';
    dayKeys.forEach(function (dk) {
      var label = new Date(groups[dk][0].ts).toLocaleDateString(ID_LOCALE, { weekday:'long', day:'numeric', month:'long' });
      html += '<div class="report-day">' + label + '</div>';
      groups[dk].forEach(function (h) {
        html += '<div class="report-row">' +
          '<span class="r-emoji">' + (CAT_EMOJI[h.cat] || '🍽️') + '</span>' +
          '<span>' + escapeHtml(h.title) + '</span>' +
          '<span class="r-cat">' + escapeHtml(h.cat) + '</span></div>';
      });
    });
    listEl.innerHTML = html;
  }

  // ---------- actions ----------
  async function choose(r, action) {
    await addRecord({ id: r.id, action: action, ts: now(), dayKey: todayKey(), title: r.title, cat: r.cat });
    toast(action === 'cook' ? '✓ ' + r.title + ' dicatat untuk hari ini' : '✗ ' + r.title + ' dilewati hari ini');
    await renderRecs();
    await renderStats();
  }

  async function removeChoice(id) {
    // delete all 'cook' records for this recipe (undo the week entry)
    var history = await getAll();
    var store = tx('readwrite');
    history.forEach(function (h) {
      if (h.id === id && h.action === 'cook') store.delete(h.key);
    });
    store.transaction.oncomplete = async function () {
      toast('Dibatalkan — menu kembali ke rekomendasi');
      await renderWeek();
      await renderRecs();
      await renderStats();
    };
  }

  // ---------- modal ----------
  function openModal(r) {
    var body = el('modal-body');
    body.innerHTML =
      '<div class="modal-body">' +
      '<h2>' + (CAT_EMOJI[r.cat]||'🍽️') + ' ' + escapeHtml(r.title) + '</h2>' +
      '<div class="card-badges"><span class="badge">' + r.cat + '</span>' +
        (r.loves ? '<span class="badge loves">❤ ' + r.loves + '</span>' : '') + '</div>' +
      '<h4>Bahan-bahan</h4><ul>' + r.ing.map(function (x){ return '<li>' + escapeHtml(x) + '</li>'; }).join('') + '</ul>' +
      '<h4>Cara memasak</h4><ol>' + r.steps.map(function (x){ return '<li>' + escapeHtml(x) + '</li>'; }).join('') + '</ol>' +
      (r.url ? '<p><a href="https://cookpad.com' + escapeHtml(r.url) + '" target="_blank" rel="noopener">Sumber di Cookpad ↗</a></p>' : '') +
      '</div>';
    el('modal').hidden = false;
  }
  function closeModal() { el('modal').hidden = true; el('modal-body').innerHTML = ''; }

  // ---------- ref modal (embed / open link) ----------
  function openRefModal(r) {
    var body = el('modal-body');
    var yt = r.source === 'YouTube' ? youtubeId(r.url) : null;
    var media;
    if (yt) {
      // YouTube embeds cleanly in an iframe.
      media = '<iframe class="ref-embed" src="https://www.youtube.com/embed/' + encodeURIComponent(yt) +
              '" title="' + escapeHtml(r.title) + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>';
    } else {
      // Instagram/TikTok/web block iframes — offer a clean open-in-new-tab button.
      media = '<p class="muted">' + escapeHtml(r.source) + ' tidak bisa ditampilkan langsung di halaman. Buka di aplikasi/tab baru:</p>' +
              '<a class="ref-link-btn" href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener">Buka di ' + escapeHtml(r.source) + ' ↗</a>';
    }
    body.innerHTML =
      '<div class="modal-body">' +
      '<h2>' + (SOURCE_EMOJI[r.source]||'🔗') + ' ' + escapeHtml(r.title) + '</h2>' +
      '<div class="card-badges"><span class="badge">' + escapeHtml(r.cat) + '</span>' +
        '<span class="badge ref-source">' + escapeHtml(r.source) + '</span></div>' +
      '<div style="margin-top:12px;">' + media + '</div>' +
      '<p style="margin-top:12px;"><a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener">' + escapeHtml(r.url) + '</a></p>' +
      '</div>';
    el('modal').hidden = false;
  }

  // ---------- references CRUD + list ----------
  async function renderRefs() {
    var refs = await getAllRefs();
    refs.sort(function (a, b) { return b.ts - a.ts; });
    var list = el('ref-list');
    list.innerHTML = '';
    if (refs.length === 0) { el('ref-empty').hidden = false; return; }
    el('ref-empty').hidden = true;
    refs.forEach(function (ref) {
      var r = refToRecipeLike(ref);
      var card = recipeCard(r, {}); // reuse card, but replace actions with ref controls
      // swap the cook/skip actions for ref-specific ones
      var actions = card.querySelector('.card-actions');
      actions.innerHTML =
        '<button class="btn btn-ok act-open">' + (SOURCE_EMOJI[r.source]||'🔗') + ' Buka</button>' +
        '<button class="btn btn-no act-del">🗑️ Hapus</button>';
      actions.querySelector('.act-open').addEventListener('click', function () { openRefModal(r); });
      actions.querySelector('.act-del').addEventListener('click', function () { removeRef(ref.key, ref.name); });
      // show whether it feeds recs
      var tag = document.createElement('div');
      tag.className = 'muted';
      tag.style.fontSize = '.76rem';
      tag.textContent = ref.inRecs ? '✓ Ikut di rekomendasi harian' : '— Hanya di daftar referensi';
      card.insertBefore(tag, actions);
      list.appendChild(card);
    });
  }

  async function addRefFromForm() {
    var name = el('ref-name').value.trim();
    var url = el('ref-url').value.trim();
    var cat = el('ref-cat').value;
    var inRecs = el('ref-in-recs').checked;
    var status = el('ref-add-status');
    if (!name) { status.textContent = 'Isi nama masakan dulu.'; return; }
    if (!isValidUrl(url)) { status.textContent = 'Link tidak valid (harus diawali http:// atau https://).'; return; }
    if (!db) { status.textContent = 'Penyimpanan tidak aktif — referensi tidak bisa disimpan.'; return; }
    var rec = { name: name, url: url, cat: cat, source: detectSource(url), inRecs: inRecs, ts: now() };
    try {
      await addRef(rec);
      el('ref-name').value = ''; el('ref-url').value = '';
      status.textContent = '';
      toast('Referensi ditambahkan');
      await renderRefs();
      await renderRecs(); // so it can appear in today's pool if opted in
    } catch (e) {
      status.textContent = 'Gagal menyimpan: ' + e.message;
    }
  }

  async function removeRef(key, name) {
    if (!confirm('Hapus referensi "' + name + '"?')) return;
    await deleteRef(key);
    toast('Referensi dihapus');
    await renderRefs();
    await renderRecs();
  }

  // ---------- backup / restore ----------
  async function exportData() {
    var history = await getAll();
    var refs = await getAllRefs();
    var payload = { app: 'masak-apa', version: 2, exportedAt: new Date().toISOString(), history: history, refs: refs };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'masak-apa-cadangan-' + todayKey() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
    toast('Cadangan diunduh');
  }
  async function importData(file) {
    try {
      var text = await file.text();
      var data = JSON.parse(text);
      if (!data || !Array.isArray(data.history)) throw new Error('Format tidak dikenal');
      var store = tx('readwrite');
      data.history.forEach(function (h) {
        if (h && typeof h.id === 'number' && h.action && h.ts) {
          store.add({ id:h.id, action:h.action, ts:h.ts, dayKey:h.dayKey || dayKey(h.ts), title:h.title||'', cat:h.cat||'' });
        }
      });
      store.transaction.oncomplete = async function () {
        // restore refs too (absent in older v1 backups)
        var refCount = 0;
        if (Array.isArray(data.refs) && db.objectStoreNames.contains(REFS)) {
          var rstore = refTx('readwrite');
          data.refs.forEach(function (rf) {
            if (rf && rf.name && rf.url) {
              rstore.add({ name: rf.name, url: rf.url, cat: rf.cat || 'Lainnya',
                           source: rf.source || detectSource(rf.url),
                           inRecs: rf.inRecs !== false, ts: rf.ts || now() });
              refCount++;
            }
          });
        }
        el('import-status').textContent = 'Dipulihkan: ' + data.history.length + ' catatan' + (refCount ? ', ' + refCount + ' referensi' : '');
        await renderRecs(); await renderWeek(); await renderStats(); await renderRefs();
        toast('Data dipulihkan');
      };
    } catch (e) {
      el('import-status').textContent = 'Gagal: ' + e.message;
    }
  }

  // ---------- ui plumbing ----------
  var toastTimer = null;
  function toast(msg) {
    var t = el('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.hidden = true; }, 2400);
  }

  function switchView(name) {
    document.querySelectorAll('.tab').forEach(function (t){ t.classList.toggle('active', t.dataset.view === name); });
    document.querySelectorAll('.view').forEach(function (v){ v.classList.toggle('active', v.id === 'view-' + name); });
    if (name === 'minggu') renderWeek();
    if (name === 'laporan') renderReport();
    if (name === 'pengaturan') renderStats();
    if (name === 'rekomendasi') renderRecs();
    if (name === 'referensi') renderRefs();
  }

  function buildCatFilter() {
    var row = el('cat-filter');
    var mk = function (val, label) {
      var b = document.createElement('button');
      b.className = 'chip' + (val === activeCat ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', function () {
        activeCat = val; reshuffleSalt = 0;
        document.querySelectorAll('#cat-filter .chip').forEach(function(c){ c.classList.remove('active'); });
        b.classList.add('active');
        renderRecs();
      });
      return b;
    };
    row.appendChild(mk('all', 'Semua'));
    CATS.forEach(function (c) { row.appendChild(mk(c, (CAT_EMOJI[c]||'') + ' ' + c)); });
  }

  function wireEvents() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchView(t.dataset.view); });
    });
    el('refresh-btn').addEventListener('click', function () { reshuffleSalt++; renderRecs(); });
    document.querySelectorAll('#report-period .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        reportDays = parseInt(c.getAttribute('data-days'), 10) || 7;
        document.querySelectorAll('#report-period .chip').forEach(function (x){ x.classList.remove('active'); });
        c.classList.add('active');
        renderReport();
      });
    });
    el('modal-close').addEventListener('click', closeModal);
    el('modal').addEventListener('click', function (e) { if (e.target === el('modal')) closeModal(); });
    el('ref-add-btn').addEventListener('click', addRefFromForm);
    var suggestBtn = el('ref-suggest-btn');
    if (suggestBtn) suggestBtn.addEventListener('click', suggestToCommunity);
    var adminIn = el('admin-signin-btn'), adminOut = el('admin-signout-btn');
    if (adminIn) adminIn.addEventListener('click', function () {
      if (cloudEnabled()) window.MasakCloud.adminSignIn().catch(function (e) { toast('Gagal masuk: ' + e.message); });
    });
    if (adminOut) adminOut.addEventListener('click', function () {
      if (cloudEnabled()) window.MasakCloud.adminSignOut().then(function(){ toast('Keluar'); });
    });
    el('export-btn').addEventListener('click', exportData);
    el('import-btn').addEventListener('click', function () { el('import-file').click(); });
    el('import-file').addEventListener('change', function (e) { if (e.target.files[0]) importData(e.target.files[0]); });
    el('reset-btn').addEventListener('click', async function () {
      if (confirm('Hapus SEMUA riwayat pilihan? Tindakan ini tidak bisa dibatalkan.')) {
        await clearAll(); toast('Semua riwayat dihapus');
        await renderRecs(); await renderWeek(); await renderStats();
      }
    });
  }

  // ---------- community cloud (Firebase, optional) ----------
  var cloudUnsubApproved = null, cloudUnsubPending = null;

  function cloudEnabled() { return window.MasakCloud && window.MasakCloud.enabled; }

  function cloudRefToRecipeLike(c) {
    return { id: c.id, title: c.name, cat: c.cat || 'Lainnya', loves: 0, ing: [], steps: [],
             isRef: true, shared: true, url: c.url, source: c.source || detectSource(c.url) };
  }

  function initCloud() {
    if (!cloudEnabled()) return; // Firebase absent — app stays local-only
    // reveal community UI + suggest button
    el('community-block').hidden = false;
    el('ref-suggest-btn').hidden = false;

    // live approved references -> merge into recs + render community list
    cloudUnsubApproved = window.MasakCloud.watchApproved(function (list) {
      CLOUD_REFS = list.map(cloudRefToRecipeLike);
      CLOUD_BY_ID = {};
      CLOUD_REFS.forEach(function (r) { CLOUD_BY_ID[r.id] = r; RECIPE_BY_ID[r.id] = r; });
      renderCommunity();
      renderRecs();
    });

    // admin auth state
    window.MasakCloud._onAuth = function (user) { refreshAdminUI(); };
    refreshAdminUI();
  }

  function renderCommunity() {
    var list = el('community-list');
    if (!list) return;
    list.innerHTML = '';
    if (CLOUD_REFS.length === 0) { el('community-empty').hidden = false; return; }
    el('community-empty').hidden = true;
    CLOUD_REFS.forEach(function (r) {
      var card = recipeCard(r, {});
      var actions = card.querySelector('.card-actions');
      var admin = window.MasakCloud.isAdmin();
      actions.innerHTML = '<button class="btn btn-ok act-open">' + (SOURCE_EMOJI[r.source]||'🔗') + ' Buka</button>' +
        (admin ? '<button class="btn btn-no act-del">🗑️ Hapus</button>' : '');
      actions.querySelector('.act-open').addEventListener('click', function () { openRefModal(r); });
      if (admin) actions.querySelector('.act-del').addEventListener('click', function () {
        if (confirm('Hapus referensi komunitas "' + r.title + '"?'))
          window.MasakCloud.removeApproved(r.id.replace('cloud:', '')).then(function(){ toast('Dihapus'); });
      });
      list.appendChild(card);
    });
  }

  function refreshAdminUI() {
    if (!cloudEnabled()) return;
    var user = window.MasakCloud.getUser();
    var isAdmin = window.MasakCloud.isAdmin();
    var configured = window.MasakCloud.hasAdminConfigured();
    var signInBtn = el('admin-signin-btn'), signOutBtn = el('admin-signout-btn');
    var statusEl = el('admin-status'), pendingBlock = el('pending-block');

    if (isAdmin) {
      statusEl.textContent = 'Masuk sebagai admin: ' + (user.displayName || user.email || 'admin');
      signInBtn.hidden = true; signOutBtn.hidden = false; pendingBlock.hidden = false;
      if (!cloudUnsubPending) {
        cloudUnsubPending = window.MasakCloud.watchPending(renderPending);
      }
    } else {
      signOutBtn.hidden = true; pendingBlock.hidden = true;
      if (cloudUnsubPending) { cloudUnsubPending(); cloudUnsubPending = null; }
      if (user && !user.isAnonymous && !configured) {
        // signed in with Google but no admin UID configured yet — show the UID to copy
        statusEl.innerHTML = 'UID kamu: <code>' + escapeHtml(user.uid) + '</code><br>Tambahkan UID ini ke ADMIN_UIDS di firebase-config.js lalu push.';
        signInBtn.hidden = true; signOutBtn.hidden = false;
      } else if (user && !user.isAnonymous && configured) {
        statusEl.textContent = 'Akun ini bukan admin.';
        signInBtn.hidden = true; signOutBtn.hidden = false;
      } else {
        statusEl.textContent = 'Masuk sebagai admin untuk meninjau saran komunitas.';
        signInBtn.hidden = false;
      }
    }
  }

  function renderPending(list) {
    var wrap = el('pending-list');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (list.length === 0) { el('pending-empty').hidden = false; return; }
    el('pending-empty').hidden = true;
    list.forEach(function (p) {
      var r = cloudRefToRecipeLike({ id: 'pending:' + p.key, name: p.name, url: p.url, cat: p.cat, source: p.source });
      var card = recipeCard(r, {});
      var actions = card.querySelector('.card-actions');
      actions.innerHTML = '<button class="btn btn-ok act-approve">✓ Setujui</button>' +
                          '<button class="btn btn-no act-reject">✗ Tolak</button>';
      actions.querySelector('.act-approve').addEventListener('click', function () {
        window.MasakCloud.approve(p.key, p).then(function(){ toast('Disetujui'); }).catch(function(e){ toast('Gagal: '+e.message); });
      });
      actions.querySelector('.act-reject').addEventListener('click', function () {
        window.MasakCloud.reject(p.key).then(function(){ toast('Ditolak'); });
      });
      wrap.appendChild(card);
    });
  }

  function suggestToCommunity() {
    var name = el('ref-name').value.trim();
    var url = el('ref-url').value.trim();
    var cat = el('ref-cat').value;
    var status = el('ref-add-status');
    if (!name) { status.textContent = 'Isi nama masakan dulu.'; return; }
    if (!isValidUrl(url)) { status.textContent = 'Link tidak valid (harus http:// atau https://).'; return; }
    if (!cloudEnabled()) { status.textContent = 'Fitur komunitas tidak aktif.'; return; }
    window.MasakCloud.suggest({ name: name, url: url, cat: cat, source: detectSource(url) })
      .then(function () {
        el('ref-name').value = ''; el('ref-url').value = '';
        status.textContent = '';
        toast('Terkirim — menunggu persetujuan admin 🌐');
      })
      .catch(function (e) { status.textContent = 'Gagal mengirim: ' + e.message; });
  }

  // ---------- boot ----------
  async function init() {
    try {
      var resp = await fetch('recipes.json');
      var data = await resp.json();
      RECIPES = data.recipes || [];
      RECIPES.forEach(function (r) { RECIPE_BY_ID[r.id] = r; });
    } catch (e) {
      document.querySelector('main').innerHTML = '<p class="empty">Gagal memuat data resep. Muat ulang halaman.</p>';
      return;
    }
    try {
      db = await openDB();
      await purgeOld();
    } catch (e) {
      // IndexedDB unavailable (e.g. private mode) — app still shows recs, no persistence
      toast('Penyimpanan tidak aktif — pilihan tidak tersimpan');
    }
    buildCatFilter();
    wireEvents();
    if (db) { await renderRecs(); } else { await renderRecsNoDb(); }
    // Firebase community sync is optional and loads as an async module, so poll
    // briefly for it; if it never appears the app just stays local-only.
    waitForCloud(0);
  }

  function waitForCloud(tries) {
    if (window.MasakCloud) { try { initCloud(); } catch (e) {} return; }
    if (tries > 40) return; // ~8s max; Firebase blocked/offline — stay local-only
    setTimeout(function () { waitForCloud(tries + 1); }, 200);
  }

  async function renderRecsNoDb() {
    // fallback: no persistence, just show random recs
    var pool = RECIPES.filter(function (r){ return activeCat==='all' || r.cat===activeCat; });
    var picked = seededPick(pool, REC_COUNT, todayKey() + '|' + reshuffleSalt);
    var list = el('rec-list'); list.innerHTML = '';
    picked.forEach(function (r) { list.appendChild(recipeCard(r)); });
    el('rec-info').textContent = 'Mode tanpa penyimpanan';
  }

  document.addEventListener('DOMContentLoaded', init);
})();
