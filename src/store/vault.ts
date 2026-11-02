// KC-0142: where Henrik's vault is — the one place the vault root is resolved
// (spec D7: the data dir and the vault are the only places user data lives).
// KC_VAULT_DIR wins; else the parent of KC_VAULT_INBOX (the inbox is the
// vault's 00-Indbakke); else <KC_DATA_DIR>/vault; '' when nothing is known.

import path from 'node:path';

export function vaultRod(e: { KC_VAULT_DIR?: string | undefined; KC_VAULT_INBOX?: string | undefined; KC_DATA_DIR?: string | undefined }): string {
  const dir = (e.KC_VAULT_DIR ?? '').trim();
  if (dir) return path.resolve(dir);
  const indbakke = (e.KC_VAULT_INBOX ?? '').trim();
  if (indbakke) return path.dirname(path.resolve(indbakke));
  const data = (e.KC_DATA_DIR ?? '').trim();
  return data ? path.resolve(data, 'vault') : '';
}
