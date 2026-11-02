// KC-0201: the "Få hjælp" mail. The builder is pure and allowlisted: a field that is not in HjaelpFelter is a type
// error (the @ts-expect-error below fails `tsc` if it ever stops being one), and nothing that is not in the list can
// reach the mail whatever a caller hands over (the sentinel tests). The link works without JavaScript.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HJAELP, HJAELP_FELTER, MAKS_MAILTO, hjaelpMail, svartid, tolkHjaelp, type HjaelpFelter } from '../../src/konto/hjaelp.ts';

const GYLDIG: HjaelpFelter = {
  kontoId: 42, plan: 'sky-husstand', status: 'forfalden', skrivebeskyttet: false,
  version: '0.1.0', sha: '1a2b3c4', release: '9f8e7d6', placering: 'lokal', sidsteFejl: 'E_KILDE_401',
};

const dekod = (mailto: string): { til: string; emne: string; tekst: string } => {
  const u = new URL(mailto);
  assert.equal(u.protocol, 'mailto:');
  return { til: decodeURIComponent(u.pathname), emne: u.searchParams.get('subject') ?? '', tekst: u.searchParams.get('body') ?? '' };
};

test('the mailbox and the response time come from config/hjaelp.json, one address', () => {
  const raa = JSON.parse(readFileSync(new URL('../../../config/hjaelp.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  assert.equal(HJAELP.postkasse, raa['postkasse']);
  assert.equal(HJAELP.postkasse, 'kontakt@clawco.work');
  assert.equal(svartid('da'), 'Vi svarer inden for 2 hverdage.');
  assert.equal(svartid('en'), 'We answer within 2 working days.');
  assert.equal(svartid('da', 5), 'Vi svarer inden for 5 hverdage.');
  assert.equal(svartid('en', 1), 'We answer within 1 working day.');
});

test('the config reader refuses a malformed file (fail closed)', () => {
  const lav = (s: string) => tolkHjaelp(JSON.parse(s));
  assert.throws(() => lav('{"postkasse":"ikke-en-adresse","svarHverdage":2,"sikkerhedSvarHverdage":5}'), /postkasse/);
  assert.throws(() => lav('{"postkasse":"a@example.test","svarHverdage":0,"sikkerhedSvarHverdage":5}'), /svarHverdage/);
  assert.throws(() => lav('{"postkasse":"a@example.test","svarHverdage":2}'), /sikkerhedSvarHverdage/);
});

test('golden: the mail to the one mailbox, with exactly the allowlisted lines and nothing else', () => {
  const m = hjaelpMail(GYLDIG);
  assert.ok(m.mailto.startsWith('mailto:kontakt@clawco.work?'));
  const d = dekod(m.mailto);
  assert.equal(d.til, 'kontakt@clawco.work');
  assert.equal(d.emne, 'Hjælp til Clawco');
  assert.equal(d.tekst, [
    'Skriv her, hvad der er galt:',
    '',
    '',
    '-- Tekniske oplysninger (du kan læse og rette dem) --',
    'Konto: 42',
    'Plan: sky-husstand',
    'Status: forfalden',
    'Skrivebeskyttet: nej',
    'Version: 0.1.0',
    'Kode: 1a2b3c4',
    'Din Clawco kører kode: 9f8e7d6',
    'Placering: lokal',
    'Sidste fejlkode: E_KILDE_401',
    '------',
    'Her står aldrig indholdet af din Clawco, din chat, dine kilder eller dine mails.',
    'Send os aldrig din modelnøgle, en adgangskode eller et kort.',
  ].join('\r\n'));
  assert.equal(m.tekst, d.tekst, 'the readable block on the page is the very text the mail carries');
});

test('the allowlist is the list of lines: a new field must be added here on purpose', () => {
  assert.deepEqual([...HJAELP_FELTER], ['kontoId', 'plan', 'status', 'skrivebeskyttet', 'version', 'sha', 'release', 'placering', 'sidsteFejl']);
  assert.deepEqual(Object.keys(GYLDIG).sort(), [...HJAELP_FELTER].sort());
});

test('a field outside the allowlist is a type error, and it never reaches the mail', () => {
  const SENTINEL = 'RUM-INDHOLD-SENTINEL-7731';
  // @ts-expect-error rumIndhold is not an allowlisted field (KC-0201: a new field is a type error)
  const m = hjaelpMail({ ...GYLDIG, rumIndhold: SENTINEL, chat: SENTINEL, kildenavn: SENTINEL, mailemne: SENTINEL, email: 'ejer@example.test' });
  assert.ok(!m.mailto.includes(SENTINEL) && !m.tekst.includes(SENTINEL));
  assert.ok(!m.tekst.includes('ejer@example.test'), 'not even the account email (the mail carries it already)');
  assert.equal(m.tekst, hjaelpMail(GYLDIG).tekst);
});

test('values are scrubbed to a plain alphabet: no line breaks, header tricks or markup survive', () => {
  const m = hjaelpMail({ ...GYLDIG, plan: 'sky-solo\r\nBcc: ond@example.test', placering: '<script>x</script>&bcc=ond@example.test', version: 'x'.repeat(400) });
  const d = dekod(m.mailto);
  assert.ok(!/\r\nBcc:/i.test(d.tekst));
  assert.ok(!d.tekst.includes('<script>'));
  assert.ok(!d.tekst.includes('ond@example.test') || !d.tekst.includes('Bcc:'));
  assert.ok(!m.mailto.includes('&bcc='), 'a value cannot add a mailto header');
  assert.equal(new URL(m.mailto).searchParams.getAll('bcc').length, 0);
  assert.ok(d.tekst.split('\r\n').every((l) => l.length <= 120), 'a value is cut short');
});

test('an unusable last-error code is dropped, not sent', () => {
  for (const ond of ['with space', 'a\nb', 'x'.repeat(41), '', 'æøå', '<b>']) {
    assert.ok(!hjaelpMail({ ...GYLDIG, sidsteFejl: ond }).tekst.includes('Sidste fejlkode'), `kept ${JSON.stringify(ond)}`);
  }
  const { sidsteFejl: _bort, ...uden } = GYLDIG;
  assert.ok(!hjaelpMail(uden).tekst.includes('Sidste fejlkode'));
});

test('the mailto stays under the common client limit; over it, the optional last-error line goes first', () => {
  const fuld = hjaelpMail(GYLDIG);
  assert.ok(fuld.mailto.length < MAKS_MAILTO, `${fuld.mailto.length} < ${MAKS_MAILTO}`);
  assert.equal(MAKS_MAILTO, 1800);
  assert.ok(fuld.tekst.includes('Sidste fejlkode'));
  // A limit just under the full length forces the cut: the code line is dropped, nothing else.
  const kortet = hjaelpMail(GYLDIG, { maks: fuld.mailto.length - 1 });
  assert.ok(!kortet.tekst.includes('Sidste fejlkode'));
  assert.ok(kortet.mailto.length < fuld.mailto.length);
  assert.equal(kortet.tekst, fuld.tekst.replace('Sidste fejlkode: E_KILDE_401\r\n', ''));
  // Even the worst case the scrubbing allows fits.
  const vaerst = hjaelpMail({ ...GYLDIG, plan: 'p'.repeat(100), status: 's'.repeat(100), version: 'v'.repeat(100), sha: 'a'.repeat(100), release: 'b'.repeat(100), placering: 'c'.repeat(100), sidsteFejl: 'e'.repeat(40) });
  assert.ok(vaerst.mailto.length < MAKS_MAILTO, `worst case ${vaerst.mailto.length}`);
});

test('the link is a plain mailto: nothing in it needs JavaScript, and the page text uses CRLF line breaks', () => {
  const m = hjaelpMail(GYLDIG);
  assert.match(m.mailto, /^mailto:[^?\s]+\?subject=[^&\s]+&body=[^\s]+$/);
  assert.ok(new URL(m.mailto).searchParams.get('body')!.includes('\r\n'));
  assert.ok(!/javascript:/i.test(m.mailto));
});
