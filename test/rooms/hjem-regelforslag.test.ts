// KC-0144: the card "Skal jeg gøre det til en regel?" in Nu's Kræver dig band.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hjemEgne, kraeverIder, renderHjem, type HjemData } from '../../src/rooms/hjem/render.ts';
import { lavForslag, type Regelforslag } from '../../src/tillid/forslag.ts';
import type { Person } from '../../src/identitet/husstand.ts';

const NOW = new Date('2026-11-01T10:00:00Z');
const henrik: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const maja: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };

const forslag = (o: Partial<Regelforslag> = {}, kortId = 'regning:revisor'): Regelforslag => ({
  ...lavForslag({ titel: 'Revisor er aldrig rutine', tekst: 'Mails fra revisoren lægger jeg altid i Kræver dig.', trin: 1, gaelder: { kilde: 'mail', slags: 'revisor' } }, { kort: { id: kortId, titel: 'Revisoren: regning' }, art: 'ret', nu: NOW }), ...o,
});
const data = (regelforslag: Regelforslag[], o: Partial<HjemData> = {}): HjemData => ({ hilsen: 'Goddag, Henrik', venter: [], hermes: [], now: NOW, person: henrik, regelforslag, ...o });
const side = (d: HjemData): string => String(renderHjem(d));

test('a pending proposal is one card: the question, the rule, the trin sentence, where it came from and three buttons — one primary', () => {
  const h = side(data([forslag()]));
  assert.match(h, /data-regelforslag="rf-[0-9a-f]{10}"/);
  assert.match(h, /Skal jeg gøre det til en regel\?/);
  assert.match(h, /Revisor er aldrig rutine/);
  assert.match(h, /Mails fra revisoren lægger jeg altid i Kræver dig\./);
  assert.match(h, /Hermes må sortere og lægge ting i Ordnet, men aldrig skrive i dine filer eller oprette aftaler\./);
  assert.match(h, /Kom fra: dit Ret på «Revisoren: regning»/);
  assert.match(h, /mail · revisor/);
  const kort = h.slice(h.indexOf('data-regelforslag="'), h.indexOf('</article>', h.indexOf('data-regelforslag="')));
  assert.equal((kort.match(/btn-primary/g) ?? []).length, 1);
  assert.match(kort, /<button type="button" class="btn btn-primary" data-regelforslag-ja="rf-[0-9a-f]{10}">Ja, gør det til en regel<\/button>/);
  assert.match(kort, /data-ask="Forslag: Revisor er aldrig rutine"[\s\S]*Ret reglen/);
  assert.match(kort, /data-regelforslag-nej="rf-[0-9a-f]{10}">Nej tak<\/button>/);
});

test('an Ikke relevant proposal says so; the card is escaped; a long pending list is one card per proposal', () => {
  const h = side(data([forslag({ art: 'ikke-relevant', titel: '<img src=x onerror=alert(1)>', tekst: '<b>fed</b> & "citat"', kortTitel: '<script>x</script>' })]));
  assert.match(h, /Kom fra: dit Ikke relevant på «&lt;script&gt;x&lt;\/script&gt;»/);
  assert.doesNotMatch(h, /<img src=x|<script>x|<b>fed/);
  assert.equal((side(data([forslag(), forslag({}, 'andet')])).match(/data-regelforslag="/g) ?? []).length, 2);
});

test('a decided proposal is not on screen (gone, not greyed out)', () => {
  const h = side(data([forslag({ status: 'godkendt' }), forslag({ status: 'afvist' }, 'andet')]));
  assert.doesNotMatch(h, /data-regelforslag/);
});

test('it waits on Henrik: it is counted and is in the Kræver dig band the day\'s number reads', () => {
  const d = data([forslag()]);
  assert.equal(hjemEgne(d), 1);
  assert.equal(hjemEgne(data([forslag({ status: 'afvist' })])), 0);
  assert.ok(kraeverIder(d).some((id) => id.startsWith('regelforslag:rf-')));
});

test('only the person the proposal belongs to sees it', () => {
  const h = side(data([forslag({ zone: 'privat', ejer: 'henrik' })], { person: maja }));
  assert.doesNotMatch(h, /data-regelforslag/);
  assert.equal(hjemEgne(data([forslag({ zone: 'privat', ejer: 'henrik' })], { person: maja })), 0);
});
