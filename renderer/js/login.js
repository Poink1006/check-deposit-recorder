'use strict';

/**
 * login.js — the shared-account sign-in gate.
 *
 * Shown when this computer has no saved session. After a successful sign-in the
 * session is persisted (main process), so it won't appear again on next launch.
 */

function friendly(msg) {
  if (!msg) return 'Sign in failed.';
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/fetch failed|network|ENOTFOUND|getaddrinfo/i.test(msg)) return 'No internet — connect and try again.';
  if (/email not confirmed/i.test(msg)) return 'This account is not confirmed yet (confirm it in Supabase).';
  return msg;
}

export function showLoginGate(onSuccess) {
  if (document.querySelector('.login-gate')) return;

  const gate = document.createElement('div');
  gate.className = 'login-gate';
  gate.innerHTML = `
    <div class="login-card">
      <h2>Check Deposit Recorder</h2>
      <p class="muted">Sign in to the shared office account to view and sync deposits.</p>
      <label class="field"><span>Email</span><input type="email" id="lg-email" autocomplete="username" /></label>
      <label class="field"><span>Password</span><input type="password" id="lg-pass" autocomplete="current-password" /></label>
      <button class="btn" id="lg-signin">Sign in</button>
      <p class="login-err" id="lg-err"></p>
    </div>`;
  document.body.appendChild(gate);

  const err = gate.querySelector('#lg-err');
  const btn = gate.querySelector('#lg-signin');

  const submit = async () => {
    const email = gate.querySelector('#lg-email').value.trim();
    const pass = gate.querySelector('#lg-pass').value;
    if (!email || !pass) { err.textContent = 'Enter email and password.'; return; }
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    err.textContent = '';
    const res = await window.api.signIn(email, pass);
    if (res.ok) {
      gate.remove();
      if (onSuccess) onSuccess();
    } else {
      btn.disabled = false;
      btn.textContent = 'Sign in';
      err.textContent = friendly(res.error);
    }
  };

  btn.addEventListener('click', submit);
  gate.querySelector('#lg-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  gate.querySelector('#lg-email').addEventListener('keydown', (e) => { if (e.key === 'Enter') gate.querySelector('#lg-pass').focus(); });
  gate.querySelector('#lg-email').focus();
}
