/* ===========================================================================
   storage.js — the working draft and small UI preferences.

   The draft lives in IndexedDB because the corpus is around a megabyte and
   localStorage caps out at roughly five, with a silent failure when it does.
   localStorage is still used, but only for preferences small enough that
   losing them costs nothing.

   A draft carries two copies of the content: the working data, and the
   published files it was started from (its base). The base is what makes a
   proper merge possible when the published files move on — with it, a change
   made on only one side can be told apart from a change made on both.
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
   * Shape: { baseVersions, base, data, savedAt, changeCount }
   * Drafts saved by older versions of the app have no base.
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

  // ---- the base the draft was started from ---------------------------------

  var base = null;

  /** A deep copy, so later edits to the working data never reach the base. */
  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function setBase(data) { base = data ? clone(data) : null; }
  function getBase() { return base; }

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
   * The three source files, read from the private ProcessHub-data repository
   * through the GitHub API. They are internal content, so they are not on
   * the public site at all; without a token that can read them this rejects
   * with err.signin set, and the page shows the sign-in screen instead.
   * Reading through the API also means a publish is visible at once, with
   * none of the minute or two the public site takes to catch up.
   */
  function fetchLive() {
    return Promise.all(FILES.map(function (name) {
      return GitHub.readData(name);
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
      return liveVersions[name] > ((draft.baseVersions || {})[name] || 0);
    });

    if (stale.length) {
      return { state: 'conflict', live: live, draft: draft, stale: stale };
    }
    return { state: 'draft', live: live, draft: draft };
  }

  /**
   * Adopt the published version numbers without taking the published
   * content. After "keep my draft" or a merge, the draft now knows about the
   * newer files, so the next export numbers itself above them rather than
   * colliding with them, and the conflict does not come back on every load.
   */
  function adoptVersions(data, live) {
    FILES.forEach(function (name) {
      if (data[name] && live[name]) {
        data[name].version = live[name].version;
      }
    });
    return data;
  }

  global.Storage = {
    FILES: FILES,
    fetchLive: fetchLive,
    versionsOf: versionsOf,
    reconcile: reconcile,
    adoptVersions: adoptVersions,
    loadDraft: loadDraft,
    saveDraft: saveDraft,
    clearDraft: clearDraft,
    setBase: setBase,
    getBase: getBase,
    clone: clone,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs
  };
}(window));
