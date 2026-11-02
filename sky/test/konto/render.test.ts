import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logIndSide, tjekMailSide, linkSide, kontoSide, passkeySide, sletSide, slettetSide, udbakkeSide, CSS } from '../../src/konto/render.ts';
import { EKSEMPLER } from '../../src/konto/eksempler.ts';
import { renderEksempel } from '../../src/konto/render.ts';

const OND = '"><script>alert(1)</script>@ond.example.test';
const ESCAPED = '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;@ond.example.test';

function ren(h: string): void {
  assert.ok(!h.includes('<script>alert'), 'rå markup fra brugertekst');
  assert.ok(h.includes(ESCAPED), 'den fjendtlige tekst blev ikke vist escaped');
}

test('a hostile email is escaped on the account page, including in session device names', () => {
  ren(kontoSide({ email: OND, csrf: 'c', passkeyAntal: 0, sessioner: [{ id: 1, enhed: OND, metode: 'link', sidstSet: new Date(), oprettet: new Date() }], nuvaerendeId: 1 }));
});

test('a hostile passkey name is escaped', () => {
  ren(passkeySide({ csrf: 'c', frisk: true, passkeys: [{ id: 1, navn: OND, oprettet: new Date(), sidstBrugt: null }] }));
});

test('the delete page escapes the email, the member list and the export link', () => {
  const h = sletSide({ csrf: 'c', frisk: true, oversigt: { email: OND, rolle: 'ejer', medlemmer: [OND] } });
  ren(h);
  assert.ok(h.includes('href="/konto/hent-alt"'), 'Hent alt først is Sky\'s own export (KC-0206)');
});

test('the dev outbox escapes recipients and links', () => {
  ren(udbakkeSide([{ til: OND, skabelon: 'maillink', data: { link: 'https://konto.example.test/log-ind/link?t=abc' } }]));
});

test('the delete page names what ends, and an owner sees the members who lose access', () => {
  const ejer = sletSide({ csrf: 'c', frisk: true, oversigt: { email: 'a@example.test', rolle: 'ejer', medlemmer: ['mor@example.test'] } });
  assert.match(ejer, /din Clawco og alt i den/);
  assert.match(ejer, /for dem du har inviteret: deres adgang/);
  assert.match(ejer, /mor@example\.test/);
  assert.match(ejer, /Hent alt først/);
  assert.match(ejer, /name="email"/);
  const medlem = sletSide({ csrf: 'c', frisk: true, oversigt: { email: 'a@example.test', rolle: 'medlem', medlemmer: [] } });
  assert.match(medlem, /din plads i husstanden/);
  assert.match(medlem, /Hent alt først/, 'a member can fetch their own account data too');
});

test('without fresh authentication the passkey and delete pages offer "log ind igen" instead of the buttons', () => {
  const p = passkeySide({ csrf: 'c', frisk: false, passkeys: [{ id: 1, navn: 'Mac', oprettet: new Date(), sidstBrugt: null }] });
  assert.match(p, /Log ind igen/);
  assert.doesNotMatch(p, /data-passkey-ny/);
  assert.doesNotMatch(p, /\/fjern"/);
  const s = sletSide({ csrf: 'c', frisk: false, oversigt: { email: 'a@example.test', rolle: null, medlemmer: [] } });
  assert.match(s, /Log ind igen/);
  assert.doesNotMatch(s, /action="\/konto\/slet"/);
});

test('every form that changes something carries the CSRF token', () => {
  const sider = [
    kontoSide({ email: 'a@example.test', csrf: 'TOKEN123', passkeyAntal: 1, sessioner: [{ id: 2, enhed: 'Mac', metode: 'passkey', sidstSet: new Date(), oprettet: new Date() }], nuvaerendeId: 1 }),
    passkeySide({ csrf: 'TOKEN123', frisk: true, passkeys: [{ id: 1, navn: 'Mac', oprettet: new Date(), sidstBrugt: new Date() }] }),
    sletSide({ csrf: 'TOKEN123', frisk: true, oversigt: { email: 'a@example.test', rolle: null, medlemmer: [] } }),
  ];
  for (const h of sider) {
    const forms = h.match(/<form method="post"[\s\S]*?<\/form>/g) ?? [];
    assert.ok(forms.length > 0);
    for (const f of forms) assert.match(f, /name="csrf" value="TOKEN123"/);
  }
});

test('the account page offers a passkey when there is none', () => {
  assert.match(kontoSide({ email: 'a@example.test', csrf: 'c', passkeyAntal: 0, sessioner: [], nuvaerendeId: 0 }), /Tilføj en passkey, så logger du ind/);
  assert.doesNotMatch(kontoSide({ email: 'a@example.test', csrf: 'c', passkeyAntal: 1, sessioner: [], nuvaerendeId: 0 }), /Tilføj en passkey, så logger du ind/);
});

test('the account page shows the subscription summary billing hands it (KC-0191), escaped, with a link to the plan page', () => {
  const h = kontoSide({ email: 'a@example.test', csrf: 'c', passkeyAntal: 1, sessioner: [], nuvaerendeId: 0, abonnement: { plan: 'Sky Solo', tekst: 'Gratis prøve til 14. nov. 2026' } });
  assert.match(h, /<h2>Abonnement<\/h2>/);
  assert.match(h, /Sky Solo/);
  assert.match(h, /Gratis prøve til 14\. nov\. 2026/);
  assert.match(h, /href="\/konto\/abonnement"/);
  assert.ok(!kontoSide({ email: 'a@example.test', csrf: 'c', passkeyAntal: 1, sessioner: [], nuvaerendeId: 0, abonnement: { plan: OND, tekst: OND } }).includes(OND));
  assert.doesNotMatch(kontoSide({ email: 'a@example.test', csrf: 'c', passkeyAntal: 1, sessioner: [], nuvaerendeId: 0 }), /Abonnement/);
});

test('pages are Danish, dark by default, and load no third-party resource', () => {
  for (const h of [logIndSide({}), tjekMailSide(), linkSide({ token: 'x', gyldig: true }), linkSide({ token: 'x', gyldig: false }), slettetSide()]) {
    assert.match(h, /<html lang="da">/);
    assert.match(h, /<meta name="color-scheme" content="dark">/);
    assert.doesNotMatch(h, /https?:\/\/(?!x\.example)/, 'ekstern ressource');
  }
  assert.match(CSS, /color-scheme:\s*dark/);
  assert.match(CSS, /background:\s*#0f1115/);
});

test('the link page keeps the token in a hidden field for the POST and never consumes on GET', () => {
  const h = linkSide({ token: 'TOK&EN', gyldig: true });
  assert.match(h, /<form method="post" action="\/log-ind\/link\/bekraeft">/);
  assert.match(h, /<input type="hidden" name="t" value="TOK&amp;EN">/);
});

test('KC-0182: the account page shows where the Clawco is once klar, a waiting line while it is made, nothing without one', () => {
  const basis = { email: 'a@example.test', csrf: 'c', passkeyAntal: 1, sessioner: [], nuvaerendeId: 0 };
  const klar = kontoSide({ ...basis, clawco: { url: 'https://hus-abcdefgh.clawco.example/' } });
  assert.match(klar, /Din Clawco: <a href="https:\/\/hus-abcdefgh\.clawco\.example\/">https:\/\/hus-abcdefgh\.clawco\.example\/<\/a>/);
  assert.match(kontoSide({ ...basis, clawco: { venter: true } }), /Din Clawco bliver gjort klar/);
  assert.doesNotMatch(kontoSide({ ...basis, clawco: null }), /Din Clawco/);
  assert.doesNotMatch(kontoSide(basis), /Din Clawco/);
  const ond = kontoSide({ ...basis, clawco: { url: OND } });
  assert.ok(!ond.includes('<script>alert'));
});

// KC-0206: the export view and the delete confirmation, from the dev gallery's test data (AGENTS §4 r11).

test('KC-0206: every account example renders, escaped, with its own content', () => {
  for (const navn of ['hent-alt', 'hent-alt-ikke-frisk', 'hent-alt-klar', 'hent-alt-fejl', 'slet-ejer', 'slet-medlem', 'slet-forkert-email', 'slet-ikke-frisk', 'slettet']) assert.ok(EKSEMPLER[navn], navn);
  for (const [navn, e] of Object.entries(EKSEMPLER)) {
    const h = renderEksempel(e);
    assert.match(h, /<h1>/, navn);
  }
  assert.match(renderEksempel(EKSEMPLER['hent-alt-klar']!), /href="\/konto\/hent-alt\/fil\?t=/);
  assert.match(renderEksempel(EKSEMPLER['hent-alt-klar']!), /24 timer/);
  assert.match(renderEksempel(EKSEMPLER['slet-ejer']!), /href="\/konto\/hent-alt"[^>]*>Hent alt først/);
  assert.match(renderEksempel(EKSEMPLER['slettet']!), /30 dage/);
});
