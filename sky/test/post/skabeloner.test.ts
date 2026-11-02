import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMail, SKABELONER, SPROG, type Skabelon, type Sprog } from '../../src/delt/skabeloner/index.ts';
import { esc } from '../../src/delt/html.ts';

const LINK = 'https://konto.example.test/log-ind/link?t=abc_DEF-123';
const OND = '<script>alert("x")</script> & Co\'';

const DATA: Record<Skabelon, Record<string, string>> = {
  maillink: { link: LINK, minutter: '15' },
  invitation: { link: LINK, inviterer: 'Henrik', husstand: 'Familien Lambert', dage: '7' },
  'konto-slettet': { dage: '30' },
};

function antal(hoe: string, naal: string): number {
  return hoe.split(naal).length - 1;
}

for (const skabelon of SKABELONER) {
  for (const sprog of SPROG) {
    test(`${skabelon} (${sprog}): subject, plain text and minimal HTML, no image, no tracking`, () => {
      const m = renderMail({ skabelon, sprog, data: DATA[skabelon] });
      assert.ok(m.emne.length > 0 && !/[\r\n]/.test(m.emne), 'emnet er én linje');
      assert.ok(m.tekst.length > 0);
      assert.match(m.html, /^<!doctype html>/i);
      assert.match(m.html, new RegExp(`<html lang="${sprog}">`));
      for (const del of [m.tekst, m.html]) {
        assert.doesNotMatch(del, /<img/i);
        assert.doesNotMatch(del, /utm_|mc_eid|_hsenc|[?&]ref=|pixel|track/i);
        assert.doesNotMatch(del, /\{\{|\}\}/, 'en pladsholder blev ikke udfyldt');
      }
      // Nothing the HTML part pulls from elsewhere: no remote style sheet, script or font.
      assert.doesNotMatch(m.html, /<script|<link|@import|url\(/i);
      if (skabelon === 'konto-slettet') {
        assert.doesNotMatch(m.tekst + m.html, /https?:\/\//);
        // KC-0206: the receipt says when the backups are gone and that invoices are kept for bookkeeping.
        assert.match(m.tekst, sprog === 'da' ? /inden for 30 dage/ : /within 30 days/);
        assert.match(m.tekst, sprog === 'da' ? /bogføringsloven/ : /bookkeeping law/);
      } else {
        assert.equal(antal(m.tekst, LINK), 1, 'linket står præcis én gang i teksten');
        assert.equal(antal(m.html, `href="${esc(LINK)}"`), 1, 'linket står præcis én gang i HTML');
        assert.equal(antal(m.html, esc(LINK)), 1);
      }
    });
  }
}

test('Danish is the default language, and the two languages differ', () => {
  const da = renderMail({ skabelon: 'maillink', data: DATA.maillink });
  assert.deepEqual(da, renderMail({ skabelon: 'maillink', sprog: 'da', data: DATA.maillink }));
  assert.notEqual(da.emne, renderMail({ skabelon: 'maillink', sprog: 'en', data: DATA.maillink }).emne);
  assert.match(da.tekst, /15 minutter/);
});

test('invitation names the inviter and the household as plain text, escaped in HTML', () => {
  for (const sprog of SPROG as readonly Sprog[]) {
    const m = renderMail({ skabelon: 'invitation', sprog, data: { ...DATA.invitation, inviterer: OND, husstand: OND } });
    assert.doesNotMatch(m.html, /<script/);
    assert.ok(m.html.includes(esc(OND)));
    assert.ok(m.tekst.includes(OND), 'teksten er ren tekst: navnet står som skrevet');
    assert.ok(m.emne.includes(OND));
  }
});

test('missing or unsafe data is refused, never sent half-filled', () => {
  const nej = (skabelon: Skabelon, data: Record<string, string>) => assert.throws(() => renderMail({ skabelon, data }), /skabelon/i);
  nej('maillink', { minutter: '15' });
  nej('maillink', { link: 'javascript:alert(1)', minutter: '15' });
  nej('maillink', { link: 'http://evil.example.test/x', minutter: '15' });
  nej('maillink', { link: 'https://konto.example.test/a b', minutter: '15' });
  nej('maillink', { link: LINK, minutter: 'femten' });
  nej('invitation', { ...DATA.invitation, inviterer: 'Henrik\r\nBcc: x@example.test' });
  nej('invitation', { ...DATA.invitation, husstand: 'a\u202Eb' });
  nej('invitation', { ...DATA.invitation, husstand: '   ' });
  nej('invitation', { ...DATA.invitation, inviterer: 'x'.repeat(81) });
  assert.throws(() => renderMail({ skabelon: 'ukendt' as Skabelon, data: {} }), /skabelon/i);
  assert.throws(() => renderMail({ skabelon: 'maillink', sprog: 'de' as Sprog, data: DATA.maillink }), /sprog/i);
});

test('a local http link is allowed for development only on localhost', () => {
  const m = renderMail({ skabelon: 'maillink', data: { link: 'http://localhost:8781/log-ind/link?t=x', minutter: '15' } });
  assert.match(m.tekst, /http:\/\/localhost:8781/);
});
