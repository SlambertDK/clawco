// KC-0142: the vault root is resolved in one place. KC_VAULT_DIR wins; else the
// parent of KC_VAULT_INBOX; else <KC_DATA_DIR>/vault; else unknown ('').

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { vaultRod } from '../../src/store/vault.ts';

test('KC_VAULT_DIR wins over the inbox and the data dir', () => {
  assert.equal(vaultRod({ KC_VAULT_DIR: '/v', KC_VAULT_INBOX: '/nas/Vault/00-Indbakke', KC_DATA_DIR: '/d' }), path.resolve('/v'));
});

test('without it: the parent of KC_VAULT_INBOX', () => {
  assert.equal(vaultRod({ KC_VAULT_DIR: ' ', KC_VAULT_INBOX: '/nas/Vault/00-Indbakke', KC_DATA_DIR: '/d' }), path.resolve('/nas/Vault'));
});

test('without either: <KC_DATA_DIR>/vault; with nothing: unknown', () => {
  assert.equal(vaultRod({ KC_VAULT_INBOX: '', KC_DATA_DIR: '/d' }), path.resolve('/d/vault'));
  assert.equal(vaultRod({}), '');
});
