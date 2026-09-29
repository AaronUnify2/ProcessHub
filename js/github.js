/* ===========================================================================
   github.js — reading and publishing through GitHub, with a token.

   Process Hub's content is split across two repositories:

     ProcessHub-data  PRIVATE  data/processes.json · library.json · variables.json
                               Internal content. Only a token can read it.
     ProcessHub       public   the app itself, and exports/FAQ.json — the
                               published FAQ content the public page reads.

   The person pastes a fine-grained personal access token once. It stays in
   this browser's localStorage on this computer: it is never written into
   the draft, an export, a commit or the page, and it is only ever sent to
   api.github.com. Without it the app has nothing to show, because the data
   can only be read through the API.

   Publishing writes the three data files as one commit on ProcessHub-data,
   then FAQ.json as one commit on ProcessHub. Each commit:

     1. reads where main is now
     2. (data only) stops if someone else has published since this draft
        started — the version numbers on GitHub must match the draft's base
     3. skips any file whose content is already identical, and the whole
        commit if nothing differs
     4. moves main to the new commit, refusing if main moved in the meantime

   Step 4 is GitHub's own check, so two people publishing at the same moment
   cannot overwrite each other: the second is refused and told to reload.
   =========================================================================== */

(function (global) {
  'use strict';

  var OWNER = 'AaronUnify2';
  var DATA_REPO = 'ProcessHub-data';
  var SITE_REPO = 'ProcessHub';
  var BRANCH = 'main';
  var API = 'https://api.github.com';
  var TOKEN_KEY = 'processhub.github.token';

  // ---- the token -----------------------------------------------------------
  // Guarded like every other storage access: a private window or blocked
  // storage must not throw, it just means nobody is signed in.

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

  /**
   * An error with a sentence a person can act on. signin is set when the
   * fix is a (new) token, so the page can show the sign-in screen.
   */
  function failure(message, status, signin) {
    var err = new Error(message);
    err.status = status || 0;
    err.signin = !!signin;
    return err;
  }

  function explain(status, what, repo) {
    if (status === 401) {
      return failure('GitHub did not accept the token. It may have expired or been ' +
        'revoked — make a new one and sign in again.', status, true);
    }
    if (status === 403 || status === 404) {
      return failure('The token cannot ' + what + '. Check it has access to both ' +
        DATA_REPO + ' and ' + SITE_REPO + ', with Contents set to "Read and write".',
        status, true);
    }
    if (status === 409 || status === 422) {
      return failure('Someone published to ' + repo + ' while this was being sent, so ' +
        'GitHub refused it to protect their work. Reload, merge, and publish again.', status);
    }
    return failure('GitHub replied with an error (' + status + ') while trying to ' + what + '.',
      status);
  }

  /**
   * One API call.
   *   repo   a repository name, or null for an account-level path like /user
   *   path   relative to the repository (may be '' for the repository itself)
   *   what   a few words for the error message ("read main")
   *   opts   { token, raw } — raw asks for a file's own content, not JSON
   *          metadata, which works however large the file grows
   */
  function call(method, repo, path, body, what, opts) {
    opts = opts || {};
    var url = API + (repo
      ? '/repos/' + OWNER + '/' + repo + (path ? '/' + path : '')
      : path);
    var headers = {
      'Accept': opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'Authorization': 'Bearer ' + (opts.token || getToken()),
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
      if (!res.ok) throw explain(res.status, what, repo);
      return res.status === 204 ? null : res.json();
    });
  }

  // ---- signing in ----------------------------------------------------------

  /**
   * Check a token before keeping it: that GitHub accepts it and that it can
   * read the private data. Whether it can write is only known for certain
   * when a publish succeeds. Resolves to { login }.
   */
  function check(token) {
    var login = '';
    return call('GET', null, '/user', null, 'identify you', { token: token })
      .then(function (user) {
        login = user && user.login;
        return call('GET', DATA_REPO, 'contents/data/variables.json?ref=' + BRANCH, null,
          'read the ' + DATA_REPO + ' repository', { token: token, raw: true });
      })
      .then(function () {
        return call('GET', SITE_REPO, '', null, 'see the ' + SITE_REPO + ' repository',
          { token: token });
      })
      .then(function () { return { login: login }; });
  }

  // ---- reading the content -------------------------------------------------

  /** One data file from the private repository, parsed. */
  function readData(name) {
    if (!hasToken()) {
      return Promise.reject(failure('Sign in to see Process Hub.', 0, true));
    }
    return call('GET', DATA_REPO, 'contents/data/' + name + '.json?ref=' + BRANCH, null,
      'read ' + name + '.json', { raw: true });
  }

  // ---- publishing ----------------------------------------------------------

  var encoder = new TextEncoder();

  /**
   * The id Git gives a file's content: SHA-1 of "blob <bytes>\0<content>".
   * Comparing it with the id on GitHub tells whether a file really changed,
   * without downloading it.
   */
  function blobSha(text) {
    var body = encoder.encode(text);
    var head = encoder.encode('blob ' + body.length + '\0');
    var all = new Uint8Array(head.length + body.length);
    all.set(head, 0);
    all.set(body, head.length);
    return crypto.subtle.digest('SHA-1', all).then(function (hash) {
      return Array.prototype.map.call(new Uint8Array(hash), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    });
  }

  function decodeBase64(b64) {
    var binary = atob(String(b64 || '').replace(/\s/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  /** The version of a data file at the commit a tree belongs to. */
  function versionAt(entries, path) {
    var entry = entries.find(function (e) { return e.path === path; });
    if (!entry) return Promise.resolve(0);
    return call('GET', DATA_REPO, 'git/blobs/' + entry.sha, null, 'read ' + path)
      .then(function (blob) {
        var text = blob.encoding === 'base64' ? decodeBase64(blob.content) : blob.content;
        return JSON.parse(text).version || 0;
      });
  }

  /**
   * Commit files to one repository as a single commit.
   *   precheck(entries)  optional; may throw to stop before anything is written
   * Resolves to { sha, url } or { skipped: true } when nothing differed.
   */
  function commitTo(repo, files, message, precheck, progress) {
    var headSha, baseTree, entries;

    return call('GET', repo, 'git/ref/heads/' + BRANCH, null, 'read ' + repo)
      .then(function (ref) {
        headSha = ref.object.sha;
        return call('GET', repo, 'git/commits/' + headSha, null, 'read ' + repo);
      })
      .then(function (commit) {
        baseTree = commit.tree.sha;
        return call('GET', repo, 'git/trees/' + baseTree + '?recursive=1', null,
          'list the files in ' + repo);
      })
      .then(function (tree) {
        entries = tree.tree || [];
        return precheck ? precheck(entries) : null;
      })
      .then(function () {
        return Promise.all(files.map(function (file) { return blobSha(file.content); }));
      })
      .then(function (shas) {
        var changed = files.filter(function (file, i) {
          var entry = entries.find(function (e) { return e.path === file.path; });
          return !entry || entry.sha !== shas[i];
        });
        if (!changed.length) return { skipped: true };

        progress('Uploading ' + changed.length + ' file' + (changed.length === 1 ? '' : 's') +
          ' to ' + repo + '…');
        return Promise.all(changed.map(function (file) {
          return call('POST', repo, 'git/blobs', { content: file.content, encoding: 'utf-8' },
            'upload ' + file.path);
        })).then(function (blobs) {
          return call('POST', repo, 'git/trees', {
            base_tree: baseTree,
            tree: changed.map(function (file, i) {
              return { path: file.path, mode: '100644', type: 'blob', sha: blobs[i].sha };
            })
          }, 'prepare the commit');
        }).then(function (tree) {
          return call('POST', repo, 'git/commits', {
            message: message, tree: tree.sha, parents: [headSha]
          }, 'make the commit');
        }).then(function (commit) {
          // force: false — GitHub refuses unless this commit sits directly on
          // top of where main is now.
          return call('PATCH', repo, 'git/refs/heads/' + BRANCH,
            { sha: commit.sha, force: false }, 'update ' + repo)
            .then(function () {
              return {
                sha: commit.sha,
                url: 'https://github.com/' + OWNER + '/' + repo + '/commit/' + commit.sha
              };
            });
        });
      });
  }

  /**
   * Publish. options:
   *   files          [{ path, content }] — data/*.json and exports/FAQ.json
   *   message        the commit message
   *   baseVersions   { processes, library, variables } this draft started from
   *   onProgress     called with a short description of each stage
   * Resolves to { data, site }, each { sha, url } or { skipped: true }.
   */
  function publish(options) {
    var progress = options.onProgress || function () {};
    var dataFiles = options.files.filter(function (f) { return f.path.indexOf('data/') === 0; });
    var siteFiles = options.files.filter(function (f) { return f.path.indexOf('exports/') === 0; });
    var result = {};

    // The files on GitHub must still be the ones this draft started from.
    // If they have moved on, publishing would quietly overwrite someone
    // else's work.
    function checkVersions(entries) {
      var names = ['processes', 'library', 'variables'];
      return Promise.all(names.map(function (name) {
        return versionAt(entries, 'data/' + name + '.json');
      })).then(function (versions) {
        var ahead = names.filter(function (name, i) {
          return versions[i] > ((options.baseVersions || {})[name] || 0);
        });
        if (ahead.length) {
          throw failure('The published files have changed since your draft started (' +
            ahead.join(', ') + '). Reload the page, review and merge, then publish.', 409);
        }
      });
    }

    progress('Checking what is on GitHub…');
    return commitTo(DATA_REPO, dataFiles, options.message, checkVersions, progress)
      .then(function (done) {
        result.data = done;
        progress('Updating the public FAQ…');
        return commitTo(SITE_REPO, siteFiles, options.message, null, progress)
          .catch(function (err) {
            // The content is safe; only the public copy lags. Publishing
            // again finds the data unchanged and just sends FAQ.json.
            var why = (err.status === 409 || err.status === 422)
              ? ' because ' + SITE_REPO + ' changed at the same moment'
              : ' (' + err.message.replace(/\.$/, '') + ')';
            err.message = 'The content was published, but the public FAQ.json was not' + why +
              '. Press "Send the FAQ" to try again.';
            err.partial = true;
            throw err;
          });
      })
      .then(function (done) {
        result.site = done;
        return result;
      });
  }

  /** Send only the public files — after a publish that stopped half way. */
  function publishSite(files, message, onProgress) {
    var siteFiles = files.filter(function (f) { return f.path.indexOf('exports/') === 0; });
    return commitTo(SITE_REPO, siteFiles, message, null, onProgress || function () {});
  }

  global.GitHub = {
    OWNER: OWNER,
    DATA_REPO: DATA_REPO,
    SITE_REPO: SITE_REPO,
    REPO: SITE_REPO,
    BRANCH: BRANCH,
    SITE: 'https://aaronunify2.github.io/' + SITE_REPO + '/',
    getToken: getToken,
    setToken: setToken,
    forgetToken: forgetToken,
    hasToken: hasToken,
    check: check,
    readData: readData,
    publish: publish,
    publishSite: publishSite
  };
}(window));
