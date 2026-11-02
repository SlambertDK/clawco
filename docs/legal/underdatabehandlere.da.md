---
version: 0.1-udkast
dato: 2026-11-02
status: laest
sprog: da
---
> UDKAST / DRAFT — skrevet af Claude 2026-10-31, læst af ejeren (Henrik Lambert) 2026-11-02. Ikke juridisk rådgivning. Ikke offentliggjort.

Version 0.1-udkast · 2026-11-02

# Underdatabehandlere for Clawco Sky

Sidst opdateret: [dato]

En underdatabehandler er en leverandør, som Henrik Lambert (personligt drevet, uden selskab) bruger til at levere Clawco Sky, og som kommer i kontakt med personoplysninger. Her er den fulde liste. Den er offentlig, så du kan se, hvem der er med.

Listen hører til Privatlivspolitik og Databehandleraftale. Overførselsgrundlagene er tjekket 2. november 2026 mod den officielle liste over Data Privacy Framework (dataprivacyframework.gov) og mod leverandørernes egne databehandleraftaler.

## Listen

| Navn | Hvad de gør | Hvor | Overførselsgrundlag |
|---|---|---|---|
| Cloudflare, Inc. | Tunnel og DNS for clawco.work og adresserne under den. Krypteringen (TLS) afsluttes i Cloudflares kant, så Cloudflare kan teknisk se trafikken til og fra din Clawco dér, også indhold. R2 til krypterede sikkerhedskopier (bygget, endnu ikke slået til). | Kanten: Cloudflares datacentre, normalt det nærmeste. R2: EU-jurisdiktion. | Cloudflare er et amerikansk selskab. Det står som aktiv deltager i EU-US Data Privacy Framework (tjekket 2. november 2026). Cloudflares databehandleraftale (cloudflare.com/cloudflare-customer-dpa/) indeholder desuden EU's standardkontrakter. |
| Stripe Payments Europe Ltd | Betaling, abonnement, fakturaer og moms | Irland | Selskabet er i EU. Hvis Stripe-koncernen overfører data til USA, bygger det på Stripes eget grundlag. Stripe, LLC (USA) står som aktiv deltager i EU-US Data Privacy Framework (tjekket 2. november 2026). |
| Resend (Plus Five Five, Inc.) | Sender mails fra os: login-links, kvitteringer og bekræftelser (køb, opsigelse, fortrydelse) og en bekræftelse, når en konto er slettet | Afsendelse fra EU-regionen i Irland. Kontodata, metadata og logs om mailene i USA. | Resend er et amerikansk selskab. På dataprivacyframework.gov står Resend 2. november 2026 som "Active - Re-certification under Review" (aktiv, fornyelsen er under behandling). Overførslen bygger derfor på EU's standardkontrakter i Resends databehandleraftale (resend.com/legal/dpa). Data Privacy Framework er et ekstra grundlag, så længe certificeringen står som aktiv. |

Der er ingen hostingleverandør på listen: din Clawco og vores database kører på vores egen server i Danmark. Vi bruger ingen ekstern fejlovervågning, og vi bruger ingen modeludbyder på dine vegne.

## Hvad der ikke er en underdatabehandler

**Din egen modeludbyder.** Bruger du din egen nøgle, vælger du selv udbyderen, og din instans sender dit indhold dertil efter din aftale med dem. I dag kan du vælge Anthropic (USA), OpenAI (USA), GitHub Copilot (GitHub, USA) eller OpenRouter (USA), eller en model, du selv kører (LM Studio eller Ollama). Det er dit valg og dit forhold til udbyderen. Tillægget "inkluderet model", hvor vi betaler modellen, findes ikke endnu. Når det kommer, kommer udbyderne på listen med 30 dages varsel.

**De tjenester, du selv kobler på.** Din mail, din kalender, dine noter og dine nyheder ligger hos de udbydere, du har valgt. Clawco læser dem for dig. De er ikke vores leverandører.

**Betalingsmetoden.** Din bank eller dit kortselskab er ikke vores underleverandør.

## Vores løfte om besked

Vi gør dette, hver gang listen ændres:

- Vi skriver til dig på e-mail mindst 30 dage, før en ny underdatabehandler begynder at behandle dine oplysninger, eller før vi skifter en ud.
- Vi skriver, hvem det er, hvad de skal gøre, hvor de er, og på hvilket grundlag en eventuel overførsel sker.
- Du kan gøre indsigelse inden for de 30 dage, hvis du har en saglig grund. Kan vi ikke imødekomme den, kan du sige abonnementet op uden ekstra omkostning. Vi refunderer det, du har betalt for tiden efter opsigelsen.
- Vi opdaterer listen og tilføjer en linje i ændringsloggen nedenfor. Datoen øverst ændres.

Haster det af hensyn til sikkerhed, fx hvis en leverandør falder fra, kan vi skifte hurtigere. Så skriver vi til dig så hurtigt som muligt, og du har samme ret til at gøre indsigelse.

Vi har en skriftlig aftale med hver underdatabehandler. De har samme krav til databeskyttelse som os (GDPR art. 28, stk. 4). Vi hæfter for dem over for dig.

## Ændringslog

| Dato | Ændring |
|---|---|
| [dato] | Første udgave af listen. |

## Spørgsmål

Skriv til kontakt@clawco.work. Selskab: Henrik Lambert (personligt drevet, uden selskab), CVR intet CVR-nummer (ikke momsregistreret; registreres når lovens grænse nås), Banevænget 13, 5270 Odense N, Danmark.
