// Nyheder in the test world (KC-0068): the morning paper in lanes, one forslag
// with a handling, one news item saved for later. Lifted from the demo's
// historie.ts (KC-0058); every relevans kind of main's schema is used.

import type { LogEntry } from '../../store/types.ts';
import { trimNyheder } from '../../rooms/nyheder/source.ts';
import { handlingerINyheder, parseNyhederState, type NyhederState } from '../../rooms/nyheder/schema.ts';
import type { Fakta } from './fakta.ts';
import { logFra, type Raa } from './faelles.ts';
import { avisFil, NYHEDEN_TITEL, rssStatus } from './kilder.ts';

export const FORTRYD_RESUME = `Fjern noten "Nyhed: ${NYHEDEN_TITEL}" fra universet Havvind Nord igen.`;

export function nyhederRaa(): Raa {
  const url = (s: string): string => `https://example.org/${s}`;
  return {
    femLinjer: [
      'Nordvik fik i morges grønt lys til den nordlige kabelkorridor i Havvind Nord; det er det valg, I tager kl. 11.',
      'Rekordmange timer med negative elpriser presser havvind-økonomien.',
      'En kabelfabrik øger kapaciteten om to år, men det hjælper ikke slottet i december.',
      'Et sikkerhedshul i en udbredt markdown-pakke er rettet; tjek dine egne projekter.',
      'Kraftig regn over Jylland fra kl. 16; derfor er løbeturen flyttet til kl. 12.15.',
    ],
    baner: [
      { navn: 'Havvind og kabler', nyheder: [
        { zone: 'privat', titel: NYHEDEN_TITEL, hvorfor: 'Myndigheden godkender den nordlige kabelkorridor; den vestlige kræver stadig dispensation.', kilde: 'Vindkraft Dagligt', url: url('vindkraft/nordvik-groent-lys'),
          relevans: [{ for: 'arbejde', note: 'Det er valget, I tager kl. 11 med Clara; nordlig rute er den godkendte.' }, { for: 'projekter', note: 'Havvind Nord: tracé-notatet og talepunkterne passer med godkendelsen.' }] },
        { zone: 'privat', titel: 'Kabelfabrik øger kapaciteten om to år', hvorfor: 'Flere produktionsslots på sigt, men ikke i år.', kilde: 'Vindkraft Dagligt', url: url('vindkraft/kabelfabrik'),
          relevans: [{ for: 'arbejde', note: 'Hjælper ikke slottet i december, som er Claras største hensyn.' }] },
      ] },
      { navn: 'Elmarkedet', nyheder: [
        { zone: 'privat', titel: 'Negative elpriser rammer havvind-økonomien', hvorfor: 'Rekordmange timer med negative priser i sidste måned.', kilde: 'Netbladet', url: url('net/negative-elpriser'),
          relevans: [{ for: 'arbejde', note: 'Et argument, når meromkostningen ved den nordlige rute skal fordeles.' }, { for: 'danmark', note: 'Kan give lavere afregning til havvind og dermed højere støttebehov.' }, { for: 'holdning', note: 'Rører ved din linje om, at fleksibelt forbrug skal belønnes frem for at blive støttet væk.' }] },
        { zone: 'privat', titel: 'Nye regler for tilslutning af havvind', hvorfor: 'Reglerne skærper kravene til tilslutningspunkter.', kilde: 'Netbladet', url: url('net/tilslutning'),
          relevans: [{ for: 'arbejde', note: 'Kan ændre Jonas\' beregning af, hvad tilslutningspunktet kan tage.' }] },
      ] },
      { navn: 'Vejr og hverdag', nyheder: [
        { zone: 'privat', titel: 'Kraftig regn over Jylland fra klokken 16', hvorfor: 'Regn kl. 16–19, 4–6 mm.', kilde: 'Vejrstationen', url: url('vejr/regn-jylland'),
          relevans: [{ for: 'mig', note: 'Løbeturen er flyttet til kl. 12.15, hvor det er tørt.' }, { for: 'familie', note: 'Ella hentes kl. 15.45, lige før regnen; regnjakken hænger i gangen.' }] },
      ] },
      { navn: 'Kode og sikkerhed', nyheder: [
        { zone: 'privat', titel: 'Sikkerhedshul i udbredt markdown-pakke', hvorfor: 'En ondsindet tekst kan køre kode i ældre versioner; rettet i den nyeste.', kilde: 'Kodebladet', url: url('kode/markdown-hul'),
          relevans: [{ for: 'projekter', note: 'Kontrolcentret viser tekst fra Hermes; tjek, om pakken er med, før du opdaterer.' }] },
      ] },
    ],
    forslag: [{
      tekst: 'Nordvik-nyheden rammer mødet kl. 11. Skal jeg lægge et kort resumé som note i Havvind Nord?',
      handling: { label: 'Læg resumé i Havvind Nord', instruktion: `Lav et kort resumé af nyheden "${NYHEDEN_TITEL}" som note i universet Havvind Nord, så det ligger klar til mødet kl. 11.`, fortryd: FORTRYD_RESUME },
    }],
    hermesStatus: 'Følger havvind og kabler',
  };
}

/** Built 07.06 from the paper; "Gem til senere" on the electricity-price story from moment 4 on. */
export function nyhederState(n: number, f: Fakta): NyhederState {
  const s = parseNyhederState(nyhederRaa(), {
    nyhedsbreve: [{ mailId: '3108', emne: 'Nyt fra Havvindsforum', fra: 'Havvindsforum' }, { mailId: '3109', emne: 'Morgenbrev', fra: 'Kystbladet' }],
    kilder: trimNyheder(avisFil(f)).kilder,
  }, new Date(f.iso('07:06')), null);
  if (n >= 4) {
    const elpris = s.baner.flatMap((b) => b.nyheder).find((x) => /Negative elpriser/.test(x.titel));
    if (elpris) s.gemt = [elpris.id];
  }
  return s;
}

export function nyhederLog(f: Fakta, n: number): LogEntry[] {
  const s = medRssKilder(nyhederState(0, f), 'morgen');
  const hid = [...handlingerINyheder(s).keys()][0] ?? 'forslag-1';
  const antal = s.baner.reduce((a, b) => a + b.nyheder.length, 0);
  // "Gem til senere" as the room writes it (nyheder/room.ts): its Fortryd removes the line from Læs senere again.
  const gemt = nyhederState(4, f);
  const elpris = gemt.baner.flatMap((b) => b.nyheder).find((x) => x.id === gemt.gemt[0]);
  const linje = elpris ? `- ${elpris.url ? `[${elpris.titel}](${elpris.url})` : elpris.titel} — ${elpris.hvorfor} (${elpris.kilde ?? 'ukendt kilde'}, ${gemt.dato})` : '';
  return logFra('nyheder', [
    { fra: 0, hhmm: '07:06', kilde: 'hermes', tekst: `Hermes udvalgte nyhederne (${antal} i ${s.baner.length} baner, ${s.kilder.nyheder} fra ${s.kilder.medNyheder} kilder).` },
    { fra: 1, hhmm: '08:15', kilde: 'hermes', tekst: 'Jeg har lagt et kort resumé af nyheden som note i universet Havvind Nord: den nordlige korridor er godkendt, den vestlige kræver stadig dispensation.', handlingId: hid, fortryd: FORTRYD_RESUME },
    ...(elpris ? [{ fra: 4, hhmm: '13:40', kilde: 'henrik' as const, tekst: `Gemte "${elpris.titel}" til senere i Obsidian.`, handlingId: `gem-${elpris.id}`, fortryd: `lokal:${JSON.stringify({ nyhedId: elpris.id, linje })}` }] : []),
  ], n, f);
}

/** KC-0137: the room as built from the paper and the world's three feeds together — the sources counted together, a feed that did not answer named. */
export function medRssKilder(state: NyhederState, momentId: string): NyhederState {
  const r = rssStatus(momentId);
  const k = state.kilder;
  return { ...state, kilder: { antal: k.antal + r.antal, medNyheder: k.medNyheder + r.medNyheder, nyheder: k.nyheder + r.nyheder, fejlede: [...k.fejlede, ...r.fejlede] } };
}
