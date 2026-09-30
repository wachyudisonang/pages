/* Masak Apa — Firebase cloud sync (community shared references).
   Loaded as a module. Exposes window.MasakCloud with a small promise-based API.
   Firebase is OPTIONAL: if this file fails to load or config is missing, the app
   still runs fully on recipes + the user's private IndexedDB refs.

   Data model (Realtime Database):
     /references/<id>  = approved, world-readable shared refs (admin-writable only)
     /pending/<id>     = community suggestions awaiting moderation (anyone may add)

   Node shape (both):
     { name, url, cat, source, ts, by }   (approved refs also carry approvedTs)
*/
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, push, get, set, remove, onValue, query, limitToLast
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

(function () {
  var cfg = window.MASAK_FIREBASE;
  if (!cfg || !cfg.config || !cfg.config.databaseURL) {
    window.MasakCloud = { enabled: false, reason: 'no-config' };
    return;
  }

  var app, auth, db;
  try {
    app = initializeApp(cfg.config);
    auth = getAuth(app);
    db = getDatabase(app);
  } catch (e) {
    window.MasakCloud = { enabled: false, reason: 'init-failed:' + e.message };
    return;
  }

  var adminUids = Array.isArray(cfg.ADMIN_UIDS) ? cfg.ADMIN_UIDS : [];
  var currentUser = null;
  var authReadyResolve;
  var authReady = new Promise(function (r) { authReadyResolve = r; });

  onAuthStateChanged(auth, function (user) {
    currentUser = user;
    authReadyResolve(user);
    if (window.MasakCloud && typeof window.MasakCloud._onAuth === 'function') {
      window.MasakCloud._onAuth(user);
    }
  });

  // Ensure at least anonymous auth so rules that require auth != null pass.
  function ensureSignedIn() {
    return authReady.then(function (user) {
      if (user) return user;
      return signInAnonymously(auth).then(function (cred) { return cred.user; })
        .catch(function () { return null; }); // anonymous may be disabled; degrade gracefully
    });
  }

  function isAdmin() {
    return !!(currentUser && !currentUser.isAnonymous && adminUids.indexOf(currentUser.uid) !== -1);
  }

  function sanitize(entry) {
    // client-side guard mirroring the DB rules; keep payload small + well-formed
    var name = String(entry.name || '').slice(0, 120).trim();
    var url = String(entry.url || '').slice(0, 500).trim();
    var cat = String(entry.cat || 'Lainnya').slice(0, 30);
    var source = String(entry.source || 'Web').slice(0, 20);
    return { name: name, url: url, cat: cat, source: source };
  }

  window.MasakCloud = {
    enabled: true,
    _onAuth: null,
    isAdmin: isAdmin,
    getUser: function () { return currentUser; },
    hasAdminConfigured: function () { return adminUids.length > 0; },

    // Sign in anonymously (for suggesting). Safe to call repeatedly.
    init: function () { return ensureSignedIn(); },

    // Admin Google sign-in / out.
    adminSignIn: function () {
      var provider = new GoogleAuthProvider();
      return signInWithPopup(auth, provider).then(function (res) { return res.user; });
    },
    adminSignOut: function () { return signOut(auth); },

    // Live listener for approved references. cb(arrayOfRefs). Returns unsubscribe.
    watchApproved: function (cb) {
      var q = query(ref(db, 'references'), limitToLast(500));
      return onValue(q, function (snap) {
        var out = [];
        snap.forEach(function (child) {
          var v = child.val() || {};
          out.push({ id: 'cloud:' + child.key, key: child.key, name: v.name, url: v.url,
                     cat: v.cat || 'Lainnya', source: v.source || 'Web', ts: v.ts || 0, shared: true });
        });
        cb(out);
      }, function () { cb([]); });
    },

    // Submit a community suggestion into /pending (requires auth, even anonymous).
    suggest: function (entry) {
      return ensureSignedIn().then(function (user) {
        if (!user) throw new Error('auth-unavailable');
        var e = sanitize(entry);
        if (!e.name || !e.url) throw new Error('invalid');
        return push(ref(db, 'pending'), {
          name: e.name, url: e.url, cat: e.cat, source: e.source,
          ts: Date.now(), by: user.uid
        });
      });
    },

    // ----- admin only -----
    watchPending: function (cb) {
      var q = query(ref(db, 'pending'), limitToLast(500));
      return onValue(q, function (snap) {
        var out = [];
        snap.forEach(function (child) {
          var v = child.val() || {};
          out.push({ key: child.key, name: v.name, url: v.url, cat: v.cat || 'Lainnya',
                     source: v.source || 'Web', ts: v.ts || 0, by: v.by || '' });
        });
        cb(out);
      }, function () { cb([]); });
    },
    approve: function (pendingKey, entry) {
      if (!isAdmin()) return Promise.reject(new Error('not-admin'));
      var e = sanitize(entry);
      return set(ref(db, 'references/' + pendingKey), {
        name: e.name, url: e.url, cat: e.cat, source: e.source,
        ts: entry.ts || Date.now(), approvedTs: Date.now(), by: entry.by || ''
      }).then(function () { return remove(ref(db, 'pending/' + pendingKey)); });
    },
    reject: function (pendingKey) {
      if (!isAdmin()) return Promise.reject(new Error('not-admin'));
      return remove(ref(db, 'pending/' + pendingKey));
    },
    removeApproved: function (key) {
      if (!isAdmin()) return Promise.reject(new Error('not-admin'));
      return remove(ref(db, 'references/' + key));
    }
  };

  // kick off anonymous sign-in early so suggesting works without a wait
  ensureSignedIn();
})();
