/* ===========================================================================
   gate.js — the sign-in screen.

   Process Hub's content lives in a private repository, so nothing can be
   shown until a token that can read it is in place. This screen asks for
   one, checks it with GitHub, keeps it in this browser, and reloads.

   The screen is a courtesy as well as a necessity: the data genuinely cannot
   be fetched without a token, and the screen explains that rather than
   leaving an empty app.

   Signing out forgets the token AND deletes the local draft, because the
   draft is a full copy of the internal content sitting on this computer.
   =========================================================================== */

(function (global) {
  'use strict';

  function e(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  /** Cover the page with the sign-in screen. message explains why, if known. */
  function show(message) {
    var old = document.getElementById('gate');
    if (old) old.remove();

    var gate = document.createElement('div');
    gate.id = 'gate';
    gate.className = 'gate';
    gate.innerHTML =
      '<div class="gate-box" role="dialog" aria-labelledby="gateTitle">' +
      '<div class="gate-brand">Process&nbsp;Hub</div>' +
      '<h1 id="gateTitle">Sign in</h1>' +
      '<p class="gate-lede">Process Hub holds internal council content, kept in a private ' +
      'repository. Sign in with your GitHub access token to open it.</p>' +
      (message ? '<p class="gate-why">' + e(message) + '</p>' : '') +
      '<label for="gateToken">Access token</label>' +
      '<input type="password" id="gateToken" autocomplete="off" spellcheck="false" ' +
      'placeholder="github_pat_…">' +
      '<p class="gate-result" id="gateResult" role="status"></p>' +
      '<button class="btn primary gate-go" id="gateGo">Sign in</button>' +
      '<details class="gh-help"><summary>Getting a token</summary><ol>' +
      '<li>On GitHub: <a href="https://github.com/settings/personal-access-tokens/new" ' +
      'target="_blank" rel="noopener">Settings → Developer settings → Fine-grained tokens → ' +
      'Generate new token</a>.</li>' +
      '<li>Repository access: <strong>Only select repositories → ' + e(GitHub.DATA_REPO) +
      ' and ' + e(GitHub.SITE_REPO) + '</strong>.</li>' +
      '<li>Permissions: <strong>Contents → Read and write</strong>. Nothing else.</li>' +
      '<li>90 days is a sensible expiry. When it runs out, make a new one and sign in again.</li>' +
      '</ol><p>The token is kept in this browser on this computer only, and is only ever ' +
      'sent to GitHub. Anyone without access to ' + e(GitHub.DATA_REPO) +
      ' cannot see the content, with or without this page.</p></details>' +
      '</div>';
    document.body.appendChild(gate);
    document.body.classList.add('gated');

    var input = document.getElementById('gateToken');
    var result = document.getElementById('gateResult');
    var go = document.getElementById('gateGo');

    function submit() {
      var token = input.value.trim();
      if (!token) { input.focus(); return; }
      go.disabled = true;
      result.className = 'gate-result busy';
      result.textContent = 'Checking with GitHub…';
      GitHub.check(token).then(function () {
        if (!GitHub.setToken(token)) {
          throw new Error('This browser will not store the token (a private window, or ' +
            'storage blocked), so it cannot keep you signed in.');
        }
        result.className = 'gate-result good';
        result.textContent = 'Signed in. Opening Process Hub…';
        location.reload();
      }).catch(function (err) {
        go.disabled = false;
        result.className = 'gate-result bad';
        result.textContent = err.message;
      });
    }

    go.addEventListener('click', submit);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') submit();
    });
    input.focus();
  }

  /**
   * Forget the token and the local draft, then show the sign-in screen.
   * unpublished: true if the draft holds changes that have not been
   * published, so the person is warned before they are thrown away.
   */
  function signOut(unpublished) {
    var warning = unpublished
      ? 'You have changes that have not been published. Signing out deletes them from ' +
        'this computer. Sign out anyway?'
      : 'Sign out? This removes your token and the local copy of the content from this ' +
        'computer.';
    if (!confirm(warning)) return;
    GitHub.forgetToken();
    Storage.clearDraft().catch(function () { /* nothing saved */ }).then(function () {
      location.reload();
    });
  }

  global.Gate = { show: show, signOut: signOut };
}(window));
