// Scripted Hermes answers for `npm run dev` (KC_AGENT=fake), so the
// room can be clicked through without a Hermes. Picks by what the prompt
// asks for; the content mirrors the canvas prototype.

import type { AgentRunRequest } from './types.ts';
import { udenData, udpak } from './udtroet.ts';

// KC-0123: Henrik's words stand outside the wrapped data segments; a segment is read by its kilde.
const henrik = (req: AgentRunRequest): string => udenData(req.input);
const seg = (req: AgentRunRequest, kilde: string): string => udpak(req.input).find((d) => d.kilde === kilde)?.tekst ?? '';

const DAGEN = {
  dato: new Date().toISOString().slice(0, 10),
  vejr: '7 °C, regn fra kl. 11',
  treLinjer: [
    'Vigtigste møde kl. 10 med driften om vinterberedskab. Materialet er klar.',
    'Internt møde om leverandørvalg er flyttet til 14.30, så kl. 13 er ledig.',
    'Regn fra kl. 11. Toget hjem går 16.42, omvej på 4 minutter ad Vestergade.',
  ],
  anbefaling: {
    tekst: 'Brug kl. 13 på udkastet til driften. Så er det ude af hovedet før mødet kl. 14.30.',
    handling: { id: 'blok-13', label: 'Blokér kl. 13 til udkastet', instruktion: 'Opret en kalenderblok 13.00-14.00 i Arbejde-kalenderen med titlen "Udkast til driften".', fortryd: 'Slet kalenderblokken "Udkast til driften" 13.00-14.00 i dag.' },
  },
  kalender: [
    { tid: '09.00', slut: '09.30', titel: 'Morgenmøde', status: 'klar' },
    { tid: '10.00', slut: '11.00', titel: 'Driften: vinterberedskab', note: 'Materialet er klar. Eksempel Energi-nyheden om reserver ligger i det.', status: 'klar', handling: { label: 'Forbered', instruktion: 'Saml materialet til mødet kl. 10 i ét dokument og læg et link i noten.' } },
    { tid: '14.30', slut: '15.30', titel: 'Internt: leverandørvalg', status: 'flyttet', handling: { label: 'Send dagsorden', instruktion: 'Lav et udkast til dagsorden for leverandørvalg og læg det som udkast. Send ikke.', tilAndre: true } },
    { tid: '16.42', titel: 'Tog hjem' },
  ],
  morgenavis: [
    { titel: 'Eksempel Energi strammer reserver i vinter', hvorfor: 'Relevant for mødet kl. 10. Ligger allerede i materialet.', kilde: 'Eksempel Energi', url: 'https://example.org/eksempel-energi/reserver' },
    { titel: 'Open-weight agentmodel matcher lukkede på værktøjsbrug', hvorfor: 'Kandidat til kira-home, hvis den kører på serveren.', kilde: 'r/LocalLLaMA', url: 'https://example.org/r/agents' },
    { titel: 'Vestergade lukket for cykler', hvorfor: 'Omvej på 4 minutter til stationen i eftermiddag.', kilde: 'Odense Kommune' },
    { titel: 'Ny udbudsrunde for fleksibilitet', hvorfor: 'Udbud åbner i november. Ingen handling i dag.', kilde: 'Eksempel Energi', url: 'https://example.org/eksempel-energi/udbud' },
  ],
  hermesStatus: 'Holder øje med kalenderen',
};

const MAIL = {
  beslutninger: [
    { mailId: '242', emne: 'Tilbud på ny eltavle', fra: 'Elektrikeren ApS', modtaget: '2026-10-26T18:57:39Z', type: 'svar', resume: 'Tilbud på 18.400 kr. for ny eltavle med 12 grupper.', betydning: 'De vil have svar inden fredag, ellers bortfalder prisen. Beløbet er 2.000 kr. over det, du regnede med; spørg om pris uden gruppeudvidelse.', frist: '2026-10-31', udkast: 'Hej\n\nTak for tilbuddet. Kan I give en pris uden udvidelsen til 12 grupper? Så vender jeg tilbage inden fredag.\n\nVenlig hilsen\nHenrik', arkivmappe: 'Folders/Afventer',
      muligheder: [{ id: 'nummer', label: 'Find deres telefonnummer', instruktion: 'Find telefonnummeret i mailens signatur og skriv det.' }, { id: 'besigtigelse', label: 'Foreslå besigtigelse', instruktion: 'Lav et udkast til et svar, der foreslår besigtigelse tirsdag kl. 16. Send ikke.', tilAndre: true }] },
    { mailId: '243', emne: 'Ugens energinyt', fra: 'EnergiWatch', modtaget: '2026-10-25T12:40:00Z', type: 'nyhedsbrev', resume: 'Ugentligt nyhedsbrev.', betydning: 'Du har ikke åbnet det i tre måneder. Afmeld, så er det væk.', arkivmappe: 'Archive',
      muligheder: [{ id: 'afmeld', label: 'Afmeld', instruktion: 'Find List-Unsubscribe i mail 243 og afmeld via https-linket.' }] },
    { mailId: '244', emne: 'VVS-faktura 4.210 kr.', fra: 'Rør & Co', modtaget: '2026-10-24T09:12:00Z', type: 'regning', resume: 'Faktura for udskiftning af blandingsbatteri.', betydning: 'Forfald 5. november. Beløbet matcher tilbuddet, så den kan bare betales.', frist: '2026-11-05', arkivmappe: 'Folders/Regninger', muligheder: [] },
  ],
  hermesStatus: 'Holder øje med Handling',
};

const KURATOR = {
  kort: [
    { id: 'tjeneste:cloudflare-pris', type: 'tjeneste', titel: 'Cloudflare hæver prisen på Workers', betyder: 'ShelfAtlas kører på Workers, og planen bliver 5 USD dyrere om måneden fra 1. december.', grundlag: ['Mail fra Cloudflare 26. okt.: "Changes to your plan"', 'ShelfAtlas bruger Workers Paid'], kilder: ['https://example.org/cloudflare/pricing'], anbefaling: 'Ingen handling nu; prisstigningen er lille. Tjek igen i november.', prioritet: 2 },
    { id: 'familie:rikke-fodselsdag', type: 'familie', titel: 'Rikke spørger om fødselsdagen', betyder: 'Rikke, din kone, spørger, om I skal holde Livas fødselsdag lørdag den 14. november hjemme.', grundlag: ['Mail fra Rikke 27. okt.'], kilder: [], anbefaling: 'Svar ja og foreslå kl. 14. Kalenderen er fri.', prioritet: 1, mailId: 'Inbox:901', handling: { id: 'familie:rikke-fodselsdag:h', label: 'Reservér lørdag', instruktion: 'Opret en kalenderaftale lørdag den 14. november kl. 14.00-17.00 med titlen "Livas fødselsdag".', fortryd: 'Slet kalenderaftalen "Livas fødselsdag" den 14. november.' } },
    { id: 'regning:vercel-okt', type: 'regning', titel: 'Vercel-regning, oktober', betyder: 'En regning på 20 USD fra Vercel for ShelfAtlas er skrevet ind i regnskabet.', grundlag: ['Mail fra Vercel 27. okt.: "Your invoice"'], kilder: [], anbefaling: 'Intet; den er betalt automatisk.', prioritet: 4, regnskab: { hvor: 'shelfatlas', dato: new Date().toISOString().slice(0, 10), leverandoer: 'Vercel', beloeb: '20,00', valuta: 'USD', periode: '2026-10', art: 'abonnement', emne: 'Your Vercel invoice' } },
  ],
  vurderinger: [],
  intet: [{ titel: 'Nyhedsbrev fra EnergiWatch', hvorfor: 'Ingen handling' }, { titel: 'Kvittering fra Netto', hvorfor: 'Intet at gøre' }],
};

// The Univers rooms (KC-0038). The markers are the MARKOER strings of rooms/univers/prompt.ts. They go before
// the broad catch-alls below (a univers chat may say "flyt", "kort", "skriv" …).
const SLIDES = (titel: string): string => `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>${titel}</title><style>
body{margin:0;background:#0E1210;color:#E8EDE9;font-family:Inter,system-ui,sans-serif;line-height:1.5}
section{box-sizing:border-box;width:100%;min-height:60vh;padding:56px 8vw;border-bottom:1px solid #26302B;display:flex;flex-direction:column;justify-content:center}
h1{font-size:2.4rem;margin:0 0 12px}h2{font-size:1.8rem;margin:0 0 12px;color:#7FD6A4}p,li{font-size:1.2rem;max-width:46rem}
</style></head><body>
<section><h1>${titel}</h1><p>Det vil jeg gerne tale med jer om i dag.</p></section>
<section><h2>Hvorfor nu</h2><ul><li>Rollen er ny, og forventningerne er endnu ikke skrevet ned.</li><li>Der er tre ting, vi kan afklare i dag.</li></ul></section>
<section><h2>Næste skridt</h2><p>Vi aftaler, hvem der gør hvad inden for to uger.</p></section>
</body></html>`;

function universSvar(i: string, req: AgentRunRequest): string | null {
  if (i.includes('Du forbereder et møde')) {
    const titel = /Mødet: ([^\n]+)/.exec(seg(req, 'kalender'))?.[1]?.trim() || 'Mødet';
    const navne = (/Deltagere: ([^\n]+)/.exec(seg(req, 'kalender'))?.[1] ?? '').split(',').map((x) => x.replace(/<[^>]*>/g, '').trim()).filter((x) => x && !/^ingen noteret/.test(x));
    const onske = /Henriks ønske til mødet: ([^\n]+)/.exec(henrik(req))?.[1]?.trim();
    const [a, b] = [navne[0] ?? 'Jonas Holm', navne[1] ?? 'Line Berg'];
    const forberedelse = {
      maal: onske && !onske.startsWith('(ikke oplyst') ? onske : 'Få afklaret, hvad der forventes af dig i den nye rolle (gæt: Hermes kender ikke dit mål endnu).',
      deltagere: [
        { navn: a, hvem: 'Din leder (gæt, tjek kartoteket)', baggrund: 'Har været i huset i otte år og kender driften godt.', vil: 'Sandsynligvis høre, hvordan du vil gribe de første 100 dage an.' },
        { navn: b, hvem: 'Kollega fra driften (gæt)', baggrund: 'Ansvarlig for vinterberedskabet.', vil: 'Sandsynligvis sikre, at dine planer ikke ændrer deres prioriteter.' },
      ],
      talepunkter: ['Åbn med, hvad du har forstået af rollen', 'Spørg ind til, hvad der skal være leveret om tre måneder', 'Nævn de to ting, du gerne vil afklare i dag', 'Slut med, hvem der gør hvad, og hvornår I mødes næste gang'],
      opgaver: [{ titel: 'Find tallene til vinterberedskabet', note: 'Spørg driften, hvis de ikke ligger i materialet.' }, { titel: 'Skriv de to spørgsmål ned', note: 'Så de ikke glemmes i samtalen.' }],
      praesentation: { titel: `Præsentation: ${titel}`, html: SLIDES(titel) },
    };
    return 'Her er forberedelsen. Det, jeg har gættet, er markeret som gæt.\n```json\n' + JSON.stringify({ forberedelse }) + '\n```';
  }
  if (i.includes('Du arbejder i Univers-oversigten')) {
    if (/univers/i.test(henrik(req)) && /lav|opret|nyt/i.test(henrik(req))) {
      const emne = /om (?:min |mit |en |et )?([^.!?\n]{2,40})/i.exec(henrik(req))?.[1]?.trim() ?? 'Mit emne';
      const navn = emne.charAt(0).toUpperCase() + emne.slice(1);
      return `Jeg har oprettet universet "${navn}".\n\`\`\`json\n` + JSON.stringify({ nytUnivers: { navn, om: `Alt om ${emne}, samlet ét sted.` } }) + '\n```';
    }
    return 'Fake Hermes: du har et univers pr. emne. Åbn et for at arbejde i det, eller bed mig om at lave et nyt.';
  }
  if (i.includes('Du arbejder i ét univers')) {
    if (/\b(hvad|hvem|hvornår|hvorfor|hvordan)\b/i.test(henrik(req)) && !/lav|skriv|tilføj|opret|gør/i.test(henrik(req))) {
      const om = /Om: ([^"\n]+)"/.exec(req.input)?.[1];
      return om ? `Om "${om}": fake Hermes svarer her. På kira-home ville jeg slå det op i vaulten og kartoteket.` : 'Fake Hermes: jeg ser universet, men kører uden model her på Mac\'en.';
    }
    const kort = henrik(req).slice(0, 60);
    return `Jeg har lagt en note og en opgave i universet.\n\`\`\`json\n` + JSON.stringify({ elementer: [{ type: 'note', titel: 'Hermes\' note', tekst: `Du bad om: ${kort}. Det vigtigste er at starte småt og bygge videre på det, der ligger.` }, { type: 'opgave', titel: `Følg op: ${kort.slice(0, 40)}`, note: 'Lagt af fake Hermes.' }] }) + '\n```';
  }
  return null;
}

export function devAnswer(req: AgentRunRequest): string {
  const i = req.instructions;
  const univers = universSvar(i, req);
  if (univers !== null) return univers;
  if (i.includes('Du er Kuratoren')) return 'Her er kortene.\n```json\n' + JSON.stringify(KURATOR) + '\n```';
  if (i.includes('har lukket et kort fra Kuratoren')) return 'Noteret i hukommelsen (fake Hermes, intet er gemt rigtigt).';
  if (i.includes('trykket "Fortryd"')) return 'Gjort om: ' + seg(req, 'fortryd').slice(0, 120);
  if (i.includes('gem den som kladde')) return 'Kladden ligger i Drafts (fake Hermes, intet er gemt rigtigt).';
  if (i.includes('Henrik har godkendt')) return 'Sendt (fake Hermes, intet er sendt rigtigt).';
  if (i.includes('baggrundsopgave')) return 'Flyttet (fake Hermes).';
  if (i.includes('trykket på knappen')) return 'Gjort: ' + seg(req, 'handling').slice(0, 140) + ' (fake Hermes, intet er ændret i den rigtige kalender eller post.)';
  if (i.includes('første udkast')) return 'Her er udkastet.\n```json\n' + JSON.stringify({ titel: /Titel: ([^\n(]+)/.exec(henrik(req))?.[1]?.trim() || 'Udkast', afsnit: ['Hej Tom.', 'Fra december strammer vi reserverne, fordi vinteren ser ud til at blive kold og tør. Det betyder, at vi holder lidt mere kapacitet tilbage end sidste år.', 'Jeg sender tallene, så snart driften har godkendt dem. Sig til, hvis du vil have dem før.'], kilder: ['Eksempel Energi-rapport om reserver, okt. 2026'] }) + '\n```';
  if (i.includes('afsnit-id\'er i klammer') && i.includes('"forslag"') && !i.includes('Regler for chatten')) { const id = /afsnitId: (a\d+)/.exec(henrik(req))?.[1] ?? 'a2'; return '```json\n' + JSON.stringify({ forslag: [{ afsnitId: id, ny: 'Fra december holder vi 15 % mere reservekapacitet tilbage end sidste vinter, fordi prognosen er kold og tør.', hvorfor: 'Konkret tal, kortere sætning.' }] }) + '\n```'; }
  if (i.includes('Regler for chatten') && i.includes('"forslag"') && /varm|kort|konkret|stram|skriv/i.test(henrik(req))) return 'Her er et forslag.\n```json\n' + JSON.stringify({ forslag: [{ afsnitId: 'a3', ny: 'Skriv endelig, så sender jeg tallene med det samme.', hvorfor: 'Varmere afslutning.' }] }) + '\n```';
  if (i.includes('rummet "Nyheder"') && i.includes('Svar med præcis dette skema')) return 'Her er avisen.\n```json\n' + JSON.stringify({ femLinjer: ['Eksempel Energi strammer reserverne til vinter; det er dit eget system, der skifter gear.', 'Agentmodellerne rykker: open-weight matcher nu lukkede på værktøjsbrug.', 'Anthropic lægger en del af overskuddet i almennyttige formål.', 'Ny udbudsrunde for fleksibilitet åbner i november.', 'Reddit-kilderne er blokeret i dag, så AI-banen er tyndere end normalt.'], baner: [{ navn: 'Energi', nyheder: [{ titel: 'Eksempel Energi strammer reserver i vinter', hvorfor: 'Strammere krav til reservekapacitet fra december.', kilde: 'Eksempel Energi', url: 'https://example.org/eksempel-energi/reserver', relevans: [{ for: 'arbejde', note: 'Det er dit eget system; ligger i materialet til mødet med driften.' }, { for: 'danmark', note: 'Kan give højere elpriser i kolde uger.' }] }, { titel: 'Ny udbudsrunde for fleksibilitet', hvorfor: 'Åbner i november; ingen handling i dag.', kilde: 'Eksempel Energi', url: 'https://example.org/eksempel-energi/udbud' }] }, { navn: 'AI og agenter', nyheder: [{ titel: 'Open-weight agent model matches closed models on tool use', hvorfor: 'Ny åben model på niveau med lukkede til værktøjsbrug.', kilde: 'r/LocalLLaMA', url: 'https://example.org/r/agents', relevans: [{ for: 'projekter', note: 'Kandidat til kira-home, hvis den kører lokalt på 16 GB.' }, { for: 'holdning', note: 'Styrker din linje om åbne modeller i eget hus.' }] }, { titel: 'Agent SDK guide', hvorfor: 'Relevant for næste rum i kontrolcentret.', kilde: 'Anthropic', url: 'https://example.org/anthropic/sdk' }] }], forslag: [{ tekst: 'Reddit blokerer serveren. Skal jeg skifte de fire r/-kilder til deres RSS-feeds?', handling: { label: 'Ja, skift til RSS', instruktion: 'Ret morgenavis_fetch.py så r/-kilderne hentes via RSS (.rss-endpoint) i stedet for JSON-API.', fortryd: 'Sæt morgenavis_fetch.py tilbage til JSON-API for r/-kilderne.' } }], hermesStatus: 'Følger energi og agenter' }) + '\n```';
  if (i.includes('rummet "Mail"') && i.includes('svar med præcis dette skema')) return 'Her er beslutningerne.\n```json\n' + JSON.stringify(MAIL) + '\n```';
  if (i.includes('"treLinjer": ["linje 1"')) return 'Her er dagen.\n```json\n' + JSON.stringify(DAGEN) + '\n```';
  if (/flyt/i.test(henrik(req))) return 'Jeg har flyttet mødet til 11.00 i rummet.\n```json\n{"opdater": {"kalender": [{"tid": "11.00", "slut": "12.00", "titel": "Driften: vinterberedskab", "status": "flyttet"}]}}\n```';
  const om = /Om: ([^"\n]+)"/.exec(req.input)?.[1];
  return om ? `Om "${om}": fake Hermes svarer her. På kira-home ville jeg slå det op i kalenderen og materialet.` : 'Fake Hermes: jeg kører uden model her på Mac\'en. På kira-home svarer den rigtige Hermes.';
}
