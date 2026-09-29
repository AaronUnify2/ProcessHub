/* ===========================================================================
   github.js — publishing straight to the repository.

   Uses a fine-grained personal access token that the person pastes in once.
   The token stays in this browser's localStorage on this computer: it is
   never written into the draft, an export, a commit or the page itself, and
   it is only ever sent to api.github.com.

   Publishing writes all four files as ONE commit on main:

     1. read where main is now
     2. read the version numbers of the data files at that commit, and stop
        if someone else has published since this draft started — merge first
     3. upload the four files, build a tree, make a commit on top of main
     4. move main to the new commit, refusing if main moved in the meantime

   Step 4 is GitHub's own check, so two people publishing at the same moment
   cannot overwrite each other: the second is refused and told to reload.
   =========================================================================== */

(function (global) {
  'use strict';

  var OWNER = 'AaronUnify2';
  var REPO = 'ProcessHub';
  var BRANCH = 'main';
  var API = 'https://api.github.com';
  var TOKEN_KEY = 'processhub.github.token';

  // ---- the token -----------------------------------------------------------
  // Guarded like every other storage access: a private window or blocked
  // storage must leave the app working, just without publishing.

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function setToken(token) {
    try { localStorage.setItem(TOKEN_KEY, token); return true; } catch (e) { return false; }
  }

  function forgetToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* nothing to remove */ }
  }

  function hasToken() { return !!getToken(); }

  // ---- talking to GitHub ---------------------------------------------------

  /** An error with a sentence a person can act on, rather than a status code. */
  function failure(message, status) {
    var err = new Error(message);
    err.status = status || 0;
    return err;
  }

  function explain(status, what) {
    if (status === 401) {
      return 'GitHub did not accept the token. It may have expired or been revoked — ' +
        'create a new one and connect again.';
    }
    if (status === 403 || status === 404) {
      return 'The token cannot ' + what + '. Check it has access to the ' + REPO +
        ' repository with Contents set to "Read and write".';
    }
    if (status === 409 || status === 422) {
      return 'Someone published to ' + REPO + ' while this was being sent, so GitHub ' +
        'refused it to protect their work. Reload, merge, and publish again.';
    }
    return 'GitHub replied with an error (' + status + ') while trying to ' + what + '.';
  }

  /**
   * One API call. path is relative to the repository unless it starts with
   * a slash. what is a few words for the error message ("read main").
   */
  function call(method, path, body, what, token) {
    var repo = '/repos/' + OWNER + '/' + REPO;
    var url = API + (path.charAt(0) === '/' ? path : repo + (path ? '/' + path : ''));
    var headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + (token || getToken()),
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (body) headers['Content-Type'] = 'application/json';

    return fetch(url, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    }).catch(function () {
      throw failure('Could not reach GitHub. Check the internet connection and try again.');
    }).then(function (res) {
      if (!res.ok) throw failure(explain(res.status, what), res.status);
      return res.status === 204 ? null : res.json();
    });
  }

  // ---- checking a token ----------------------------------------------------

  /**
   * Check a token before keeping it: that GitHub accepts it, and that it can
   * see this repository and its main branch. Whether it can write is only
   * known for certain when a publish succeeds, so the result says so.
   * Resolves to { login, repo }.
   */
  function check(token) {
    var login = '';
    return call('GET', '/user', null, 'identify you', token)
      .then(function (user) {
        login = user && user.login;
        return call('GET', '', null, 'see the ' + REPO + ' repository', token);
      })
      .then(function () {
        return call('GET', 'git/ref/heads/' + BRANCH, null, 'read the ' + BRANCH + ' branch', token);
      })
      .then(function () {
        return { login: login, repo: OWNER + '/' + REPO };
      });
  }

  // ---- publishing ----------------------------------------------------------

  /** Decode a base64 blob from the API as UTF-8 text. */
  function decodeBase64(b64) {
    var binary = atob(String(b64 || '').replace(/\s/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  /**
   * The version of one data file at a given commit, read through the tree so
   * it works however large the file grows.
   */
  function versionAt(treeEntries, path) {
    var entry = treeEntries.find(function (e) { return e.path === path; });
    if (!entry) return Promise.resolve(0);
    return call('GET', 'git/blobs/' + entry.sha, null, 'read ' + path)
      .then(function (blob) {
        var text = blob.encoding === 'base64' ? decodeBase64(blob.content) : blob.content;
        return (JSON.parse(text).version) || 0;
      });
  }

  /**
   * Publish the files. options:
   *   files          [{ path, content }] — the full text of each file
   *   message        the commit message
   *   baseVersions   { processes, library, variables } this draft started from
   *   onProgress     called with a short description of each stage
   * Resolves to { sha, url }.
   */
  function publish(options) {
    var progress = options.onProgress || function () {};
    var headSha, baseTree;

    progress('Checking what is on GitHub…');
    return call('GET', 'git/ref/heads/' + BRANCH, null, 'read the ' + BRANCH + ' branch')
      .then(function (ref) {
        headSha = ref.object.sha;
        return call('GET', 'git/commits/' + headSha, null, 'read the latest commit');
      })
      .then(function (commit) {
        baseTree = commit.tree.sha;
        return call('GET', 'git/trees/' + baseTree + '?recursive=1', null, 'list the files');
      })
      .then(function (tree) {
        // The files on GitHub must still be the ones this draft started
        // from. If they have moved on, publishing would quietly overwrite
        // someone else's work.
        var names = ['processes', 'library', 'variables'];
        return Promise.all(names.map(function (name) {
          return versionAt(tree.tree || [], 'data/' + name + '.json');
        })).then(function (versions) {
          var ahead = names.filter(function (name, i) {
            return versions[i] > ((options.baseVersions || {})[name] || 0);
          });
          if (ahead.length) {
            throw failure('The published files have changed since your draft started (' +
              ahead.join(', ') + '). Reload the page, review and merge, then publish. The ' +
              'site can take a minute or two to show the new version, so if no merge bar ' +
              'appears, wait a moment and reload again.', 409);
          }
        });
      })
      .then(function () {
        progress('Uploading ' + options.files.length + ' files…');
        return Promise.all(options.files.map(function (file) {
          return call('POST', 'git/blobs', { content: file.content, encoding: 'utf-8' },
            'upload ' + file.path);
        }));
      })
      .then(function (blobs) {
        return call('POST', 'git/trees', {
          base_tree: baseTree,
          tree: options.files.map(function (file, i) {
            return { path: file.path, mode: '100644', type: 'blob', sha: blobs[i].sha };
          })
        }, 'prepare the commit');
      })
      .then(function (tree) {
        progress('Committing…');
        return call('POST', 'git/commits', {
          message: options.message,
          tree: tree.sha,
          parents: [headSha]
        }, 'make the commit');
      })
      .then(function (commit) {
        // force: false — GitHub refuses unless this commit sits directly on
        // top of where main is now.
        return call('PATCH', 'git/refs/heads/' + BRANCH, { sha: commit.sha, force: false },
          'update the ' + BRANCH + ' branch')
          .then(function () {
            return {
              sha: commit.sha,
              url: 'https://github.com/' + OWNER + '/' + REPO + '/commit/' + commit.sha
            };
          });
      });
  }

  global.GitHub = {
    OWNER: OWNER,
    REPO: REPO,
    BRANCH: BRANCH,
    SITE: 'https://aaronunify2.github.io/' + REPO + '/',
    getToken: getToken,
    setToken: setToken,
    forgetToken: forgetToken,
    hasToken: hasToken,
    check: check,
    publish: publish
  };
}(window));
