/* ===========================================================================
   storage.js — the working draft and small UI preferences.

   The draft lives in IndexedDB because the corpus is around a megabyte and
   localStorage caps out at roughly five, with a silent failure when it does.
   localStorage is still used, but only for preferences small enough that
   losing them costs nothing.
   =========================================================================== */

(function (global) {
  'use strict';

  var DB_NAME = 'processhub';
  var DB_VERSION = 1;
  var STORE = 'drafts';
  var DRAFT_KEY = 'working';
  var PREFS_KEY = 'processhub.prefs.v1';

  // ---- IndexedDB -----------------------------------------------------------

  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
    return dbPromise;
  }

  function withStore(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var request = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { resolve(request ? request.result : undefined); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  /**
   * The saved draft, or null when there isn't one.
   * Shape: { baseVersions, data, savedAt, changeCount }
   */
  function loadDraft() {
    return withStore('readonly', function (store) {
      return store.get(DRAFT_KEY);
    }).catch(function (err) {
      console.warn('Could not read the draft:', err);
      return null;
    });
  }

  function saveDraft(draft) {
    draft.savedAt = new Date().toISOString();
    return withStore('readwrite', function (store) {
      return store.put(draft, DRAFT_KEY);
    }).then(function () {
      return draft;
    });
  }

  function clearDraft() {
    return withStore('readwrite', function (store) {
      return store.delete(DRAFT_KEY);
    });
  }

  // ---- preferences ---------------------------------------------------------
  // Every read and write is guarded: storage can be unavailable in a private
  // window, and a missing preference must never stop the app rendering.

  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function savePrefs(prefs) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
      /* preferences are a convenience; losing them is not an error */
    }
  }

  // ---- fetching the published files ---------------------------------------

  var FILES = ['processes', 'library', 'variables'];

  /**
   * Fetch the three source files. Cache-busted, because GitHub Pages responses
   * are cached and a just-committed update would otherwise look like it had
   * not landed.
   */
  function fetchLive() {
    var stamp = Date.now();
    return Promise.all(FILES.map(function (name) {
      return fetch('data/' + name + '.json?t=' + stamp, { cache: 'no-cache' })
        .then(function (res) {
          if (!res.ok) throw new Error(name + '.json — HTTP ' + res.status);
          return res.json();
        });
    })).then(function (results) {
      var out = {};
      FILES.forEach(function (name, i) { out[name] = results[i]; });
      return out;
    });
  }

  function versionsOf(data) {
    var out = {};
    FILES.forEach(function (name) {
      out[name] = (data[name] && data[name].version) || 0;
    });
    return out;
  }

  /**
   * Decide what to show on load.
   *   'live'     nothing saved locally
   *   'draft'    the draft was taken from this same published version
   *   'conflict' the published files moved on since the draft was started
   */
  function reconcile(live, draft) {
    if (!draft || !draft.data) return { state: 'live', live: live };

    var liveVersions = versionsOf(live);
    var stale = FILES.filter(function (name) {
      return liveVersions[name] > (draft.baseVersions || {})[name];
    });

    if (stale.length) {
      return { state: 'conflict', live: live, draft: draft, stale: stale };
    }
    return { state: 'draft', live: live, draft: draft };
  }

  global.Storage = {
    FILES: FILES,
    fetchLive: fetchLive,
    versionsOf: versionsOf,
    reconcile: reconcile,
    loadDraft: loadDraft,
    saveDraft: saveDraft,
    clearDraft: clearDraft,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs
  };
}(window));
