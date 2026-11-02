// KC-0069: the coverage markers are exact. Each tightened marker fails on the loose match that used to satisfy it and
// passes on the exact one (a table), and every attribute marker needs a real attribute boundary in front of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAEKNING, vises } from '../../src/testtilstand/daekning.ts';

const ud = (id: string) => {
  const d = DAEKNING.find((x) => x.id === id);
  assert.ok(d, `${id} is on the coverage list`);
  return d;
};

// [id, what the loose marker used to accept, what only the exact state renders]
const TABEL: [string, string, string][] = [
  ['skriv-igen',
    '<button type="button" class="btn btn-primary" data-regnskab="privat">Skriv i privat</button>', // a first write of an unwritten bill with a ledger
    '<button type="button" class="btn btn-primary" data-regnskab="privat" data-regnskab-igen="">Skriv i privat</button>'],
  ['tone:rolig', '<span class="vis-ikon tilstand-rolig"><svg></svg></span>', '<span class="vis-ikon tilstand-rolig" data-tone="rolig"><svg></svg></span>'], // a card without any tone
  ['tone:god', '<span class="vis-ikon tilstand-ordnet"><svg></svg></span>', '<span class="vis-ikon tilstand-ordnet" data-tone="god"><svg></svg></span>'],
  ['tone:adv', '<span class="vis-ikon tilstand-kraever"><svg></svg></span>', '<span class="vis-ikon tilstand-kraever" data-tone="adv"><svg></svg></span>'],
  ['lyt', '<div class="msg" mydata-sig="Hej">', '<div class="msg" data-sig="Hej">'],
  ['fortryd-log', '<li class="x" nodata-fortryd="a1">', '<button class="btn" data-fortryd="a1">Fortryd</button>'],
  ['kilde-nyheder-egne', '<li xdata-kilde-feed="https://a.example">', '<li data-kilde-feed="https://a.example">'],
];

for (const [id, loes, praecis] of TABEL) {
  test(`marker ${id}: fails on the loose match, passes on the exact one`, () => {
    const d = ud(id);
    assert.equal(vises(d.marker, loes), false, `${id} must not be satisfied by: ${loes}`);
    assert.equal(vises(d.marker, praecis), true, `${id} must be satisfied by: ${praecis}`);
  });
}

test('every attribute marker (data-…) needs an attribute boundary: a glued-on prefix does not count, a space or newline does', () => {
  const attr = DAEKNING.filter((d) => /^data-[a-z]/.test(d.marker));
  assert.ok(attr.length > 40, `${attr.length} attribute markers`);
  for (const d of attr) {
    assert.equal(vises(d.marker, `<i x${d.marker}1">`), false, `${d.id}: "x${d.marker}"`);
    assert.equal(vises(d.marker, `<i ${d.marker}1">`), true, `${d.id}: " ${d.marker}"`);
    assert.equal(vises(d.marker, `<i\n${d.marker}1">`), true, `${d.id}: newline before`);
    assert.equal(vises(d.marker, `${d.marker}1"`), false, `${d.id}: at the very start of the text is not inside a tag`);
  }
});

test('markers that are not attributes are still a plain substring', () => {
  assert.equal(vises('class="card alt-ordnet"', '<div class="card alt-ordnet">'), true);
  assert.equal(vises('<body data-room="hjem"', '<html><body data-room="hjem" class="x">'), true);
  assert.equal(vises('Fra arbejdet', 'x Fra arbejdet y'), true);
  assert.equal(vises('Fra arbejdet', 'Fra familien'), false);
});

test('a marker found later in the text still counts when an earlier hit has no boundary', () => {
  assert.equal(vises('data-sig="', 'x data-sig="a" ... <p xdata-sig="b"'), true);
  assert.equal(vises('data-sig="', 'xdata-sig="b" and again ydata-sig="c"'), false);
});
