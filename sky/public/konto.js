// Passkeys in the browser (KC-0177). The server builds and checks everything with
// @simplewebauthn/server; this only hands its JSON to navigator.credentials and posts the answer back.
// No library: PublicKeyCredential.parse*OptionsFromJSON and credential.toJSON() are built in.
(() => {
  const csrf = document.querySelector('meta[name="csrf"]')?.getAttribute('content') ?? '';

  async function post(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf': csrf },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.fejl || String(r.status));
    return data;
  }

  const kanPasskey = () => typeof window.PublicKeyCredential === 'function'
    && typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function'
    && typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function';

  function knap(sel, handling) {
    const k = document.querySelector(sel);
    if (!k) return;
    const status = document.querySelector('[data-status]');
    k.addEventListener('click', async () => {
      if (status) status.textContent = '';
      if (!kanPasskey()) { if (status) status.textContent = k.dataset.ikkeUnderstoettet ?? ''; return; }
      k.disabled = true;
      try {
        location.assign(await handling(k));
      } catch (err) {
        // A cancelled prompt is a NotAllowedError; either way the person can try again or use mail.
        if (status) status.textContent = k.dataset.fejl ?? '';
        k.disabled = false;
      }
    });
  }

  knap('[data-passkey-login]', async (k) => {
    const o = await post('/log-ind/passkey/muligheder', {});
    const cred = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(o) });
    const r = await post('/log-ind/passkey', { svar: cred.toJSON(), til: k.dataset.til });
    return r.til;
  });

  knap('[data-passkey-ny]', async () => {
    const o = await post('/konto/passkeys/ny/muligheder', {});
    const cred = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(o) });
    const navn = document.querySelector('[data-passkey-navn]')?.value ?? '';
    const r = await post('/konto/passkeys/ny', { svar: cred.toJSON(), navn });
    return r.til;
  });
})();
