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
  kvittering: { saelger: 'Sælger Eksempel (personligt drevet)', produkt: 'Sky Solo', pris: '79 kr. om måneden', betaling: 'Næste betaling 2. december 2026.', fortrydfrist: '16. november 2026', vilkaarversion: '0.1-udkast', vilkaarlink: 'https://clawco.example/vilkaar', link: LINK },
  fortrydelse: { saelger: 'Sælger Eksempel (personligt drevet)', produkt: 'Sky Solo', tidspunkt: '5. november 2026 kl. 11.00', tilbage: 'Vi tilbagebetaler 65,83 kr. inden for 14 dage.' },
  opsigelse: { saelger: 'Sælger Eksempel (personligt drevet)', produkt: 'Sky Solo', slutter: '2. december 2026', link: LINK },
  fornyelse: { saelger: 'Sælger Eksempel (personligt drevet)', produkt: 'Sky Solo', pris: '790 kr. om året', dato: '2. november 2027', link: LINK },
  'stoette-startet': { timer: '4', til: '14.05' },
  alarm: { titel: 'Få ledige pladser', tekst: 'Kun 2 ledige kundepladser tilbage (grænsen er 3).' },
  'betaling-fejlet': { produkt: 'Sky Solo', dato: '14. november 2026', link: LINK },
  'betaling-paamindelse': { produkt: 'Sky Solo', dato: '14. november 2026', link: LINK },
  'proeve-slut': { dato: '14. november 2026', link: LINK },
  velkomst: { link: LINK, abonnement: 'Din gratis prøve slutter 16. november 2026.', hjaelp: 'kontakt@hjaelp.example.test', svartid: 'Vi svarer inden for 2 hverdage.', konto: 'https://konto.example.test/konto', saelger: 'Sælger Eksempel (personligt drevet), Eksempelvej 1, 5000 Odense C, Danmark.' },
  'kom-i-gang': { link: LINK, afmeld: 'https://konto.example.test/post/afmeld?t=afmeld_TOKEN', hjaelp: 'kontakt@hjaelp.example.test', saelger: 'Sælger Eksempel (personligt drevet), Eksempelvej 1, 5000 Odense C, Danmark.' },
  'proeve-slutter': { dato: '16. november 2026', link: LINK, saelger: 'Sælger Eksempel (personligt drevet), Eksempelvej 1, 5000 Odense C, Danmark.' },
};

/** Mails that carry no link of the generic kind (the account link): the deletion receipt, the withdrawal receipt and an operator alert. */
const UDEN_LINK = new Set<Skabelon>(['konto-slettet', 'fortrydelse', 'alarm']);

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
      } else if (skabelon === 'stoette-startet') {
        // KC-0188: the owner's notice when support starts: how long, until when, that it includes mail and calendar, how to stop it.
        assert.doesNotMatch(m.tekst + m.html, /https?:\/\//);
        assert.match(m.tekst, sprog === 'da' ? /i 4 timer, til kl\. 14\.05/ : /for 4 hours, until 14\.05/);
        assert.match(m.tekst, sprog === 'da' ? /din mail og din kalender/ : /your mail and your calendar/);
        assert.match(m.tekst, /Slå fra/);
      } else if (UDEN_LINK.has(skabelon)) {
        assert.doesNotMatch(m.tekst + m.html, /https?:\/\//);
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

// KC-0209: what the consumer-rights mails must say.
test('the receipt names the seller, product, price, period, how to cancel, how to withdraw and the accepted terms version with its link', () => {
  for (const sprog of SPROG as readonly Sprog[]) {
    const m = renderMail({ skabelon: 'kvittering', sprog, data: DATA.kvittering });
    for (const del of [m.tekst, m.html]) {
      for (const v of ['Sælger Eksempel (personligt drevet)', 'Sky Solo', '79 kr. om måneden', 'Næste betaling 2. december 2026.', '16. november 2026', '0.1-udkast', 'https://clawco.example/vilkaar']) assert.ok(del.includes(v), `${sprog}: ${v}`);
      assert.match(del, sprog === 'da' ? /Opsig abonnement/ : /Cancel subscription/);
      assert.match(del, sprog === 'da' ? /Fortryd aftale/ : /Withdraw from the agreement/);
      assert.match(del, sprog === 'da' ? /14 dages fortrydelsesret/ : /14-day right of withdrawal/);
      assert.doesNotMatch(del, /moms|\bVAT\b/i, 'no VAT is shown anywhere while the seller is not VAT-registered (KC-0194, G6)');
    }
  }
});

test('the withdrawal receipt, the cancellation and the reminder carry the seller and the one thing they are about', () => {
  for (const sprog of SPROG as readonly Sprog[]) {
    const f = renderMail({ skabelon: 'fortrydelse', sprog, data: DATA.fortrydelse });
    assert.ok(f.tekst.includes('Vi tilbagebetaler 65,83 kr. inden for 14 dage.') && f.tekst.includes('5. november 2026 kl. 11.00') && f.tekst.includes('Sælger Eksempel'));
    const o = renderMail({ skabelon: 'opsigelse', sprog, data: DATA.opsigelse });
    assert.ok(o.tekst.includes('2. december 2026') && o.tekst.includes('Sælger Eksempel'));
    const n = renderMail({ skabelon: 'fornyelse', sprog, data: DATA.fornyelse });
    assert.ok(n.tekst.includes('790 kr. om året') && n.tekst.includes('2. november 2027') && n.tekst.includes('Sælger Eksempel'));
  }
});

test('the consumer-rights mails refuse a line with a newline or an over-long line', () => {
  const nej = (skabelon: Skabelon, data: Record<string, string>) => assert.throws(() => renderMail({ skabelon, data }), /skabelon/i);
  nej('kvittering', { ...DATA.kvittering, saelger: 'a\r\nBcc: x@example.test' });
  nej('kvittering', { ...DATA.kvittering, pris: 'x'.repeat(301) });
  nej('fortrydelse', { ...DATA.fortrydelse, tilbage: '' });
  nej('opsigelse', { ...DATA.opsigelse, link: 'http://evil.example.test/x' });
});

test('KC-0196: the grace mails name the date and the product, and promise nothing is deleted (as the published terms do)', () => {
  for (const sprog of SPROG as readonly Sprog[]) {
    for (const skabelon of ['betaling-fejlet', 'betaling-paamindelse', 'proeve-slut'] as const) {
      const m = renderMail({ skabelon, sprog, data: DATA[skabelon] });
      assert.ok(m.tekst.includes('14. november 2026'), `${skabelon} ${sprog}: datoen`);
      assert.match(m.tekst, sprog === 'da' ? /bliver ikke slettet|intet bliver slettet/ : /not deleted|nothing is deleted/);
      if (skabelon !== 'proeve-slut') assert.ok(m.tekst.includes('Sky Solo'), `${skabelon} ${sprog}: produktet`);
      // Never a card number or an amount: the card is fixed on Stripe's page, reached from the account page.
      assert.doesNotMatch(m.tekst, /\d{4}[ -]?\d{4}[ -]?\d{4}/);
    }
  }
  assert.match(renderMail({ skabelon: 'betaling-fejlet', data: DATA['betaling-fejlet'] }).tekst, /ret(te)? kortet/i);
  assert.match(renderMail({ skabelon: 'proeve-slut', sprog: 'en', data: DATA['proeve-slut'] }).tekst, /paused until you choose a plan/);
});

// KC-0200: the welcome mails. Every value lands once in each part (escaped in HTML), the seller's identity closes every
// mail, and only the tips mail carries an unsubscribe link (the other two are service messages).
test('KC-0200: the welcome mails carry every value in both parts, the seller last, and the unsubscribe link only on the tips mail', () => {
  for (const sprog of SPROG as readonly Sprog[]) {
    for (const skabelon of ['velkomst', 'kom-i-gang', 'proeve-slutter'] as const) {
      const data = DATA[skabelon];
      const m = renderMail({ skabelon, sprog, data });
      for (const [navn, v] of Object.entries(data)) {
        assert.ok(m.tekst.includes(v), `${skabelon} ${sprog}: ${navn} i teksten`);
        assert.ok(m.html.includes(esc(v)), `${skabelon} ${sprog}: ${navn} i HTML`);
      }
      assert.ok(m.tekst.trimEnd().endsWith(data['saelger']!), `${skabelon} ${sprog}: sælgeren står til sidst`);
      assert.equal(/afmeld|unsubscribe/i.test(m.tekst), skabelon === 'kom-i-gang', `${skabelon} ${sprog}: afmeld kun i tips-mailen`);
    }
    const v = renderMail({ skabelon: 'velkomst', sprog, data: DATA.velkomst });
    assert.match(v.tekst, sprog === 'da' ? /kalender eller din mail/ : /calendar or your mail/);
    assert.match(v.tekst, sprog === 'da' ? /Svar på denne mail/ : /Reply to this mail/);
    const k = renderMail({ skabelon: 'kom-i-gang', sprog, data: DATA['kom-i-gang'] });
    // Clawco cannot know whether a source is connected (no read access, telemetry is opt-in): worded for everyone.
    assert.match(k.tekst, sprog === 'da' ? /Har du endnu ikke koblet en kilde til/ : /If you have not connected a source yet/);
    const p = renderMail({ skabelon: 'proeve-slutter', sprog, data: DATA['proeve-slutter'] });
    assert.match(p.emne, sprog === 'da' ? /om to dage/ : /in two days/);
    assert.match(p.tekst, sprog === 'da' ? /bliver ikke slettet/ : /not deleted/);
    assert.match(p.tekst, sprog === 'da' ? /pause/ : /paused/);
  }
});

test('KC-0200: a seller line with markup is escaped in HTML and kept as written in the text', () => {
  for (const sprog of SPROG as readonly Sprog[]) {
    const m = renderMail({ skabelon: 'velkomst', sprog, data: { ...DATA.velkomst, saelger: OND } });
    assert.doesNotMatch(m.html, /<script/);
    assert.ok(m.html.includes(esc(OND)));
    assert.ok(m.tekst.includes(OND));
  }
});
