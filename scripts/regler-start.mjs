#!/usr/bin/env node
// Usage (on kira-home, from the checkout): node --env-file=.env scripts/regler-start.mjs
// KC-0142: one-off migration for the reference install. Writes the behaviours
// Hermes already follows (src/tillid/start.ts) as the first rules file in
// <vault>/Clawco/regler.md — only when no rules file exists. Prints the path
// and what it did; never prints anything from .env.
import { lavVaultStier } from '../src/kilder/noter/stier.ts';
import { lavReglerLager } from '../src/tillid/lager.ts';
import { skrivStartregler } from '../src/tillid/start.ts';

const dataDir = (process.env.KC_DATA_DIR ?? '').trim() || './data';
// KC-0213: the one vault root (env, else the vault chosen on the notes card, else <data>/vault).
const vaultDir = lavVaultStier({ dataDir, env: { KC_VAULT_DIR: process.env.KC_VAULT_DIR, KC_VAULT_INBOX: process.env.KC_VAULT_INBOX } })().rod;
const dato = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(new Date());
const lager = lavReglerLager({ vaultDir, dataDir });
const udfald = await skrivStartregler(lager, dato);
console.log(udfald === 'skrevet' ? `Skrev de første regler i ${lager.fil}` : `Der findes allerede en regelfil i ${lager.fil}; intet ændret.`);
