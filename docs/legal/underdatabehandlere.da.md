---
version: 1.2
dato: 2026-11-03
status: udgivet
sprog: da
---
Version 1.2 · 2026-11-03

# Underdatabehandlere for Clawco Sky

Sidst opdateret: 2026-11-03

En underdatabehandler er en leverandør, som Henrik Lambert (personligt drevet, uden selskab) bruger til at levere Clawco Sky, og som kommer i kontakt med personoplysninger. Her er den fulde liste. Den er offentlig, så du kan se, hvem der er med.

Listen hører til Privatlivspolitik og Databehandleraftale. Overførselsgrundlagene er tjekket 2. november 2026 mod den officielle liste over Data Privacy Framework (dataprivacyframework.gov) og mod leverandørernes egne databehandleraftaler.

## Listen

| Navn | Hvad de gør | Hvor | Overførselsgrundlag |
|---|---|---|---|
| Cloudflare, Inc. | Tunnel og DNS for clawco.work og adresserne under den. Krypteringen (TLS) afsluttes i Cloudflares kant, så Cloudflare kan teknisk se trafikken til og fra din Clawco dér, også indhold. R2 til krypterede sikkerhedskopier (bygget, endnu ikke slået til). | Kanten: Cloudflares datacentre, normalt det nærmeste. R2: EU-jurisdiktion. | Cloudflare er et amerikansk selskab. Det står som aktiv deltager i EU-US Data Privacy Framework (tjekket 2. november 2026). Cloudflares databehandleraftale (cloudflare.com/cloudflare-customer-dpa/) indeholder desuden EU's standardkontrakter. |
| Stripe Payments Europe Ltd | Betaling, abonnement, fakturaer og moms | Irland | Selskabet er i EU. Hvis Stripe-koncernen overfører data til USA, bygger det på Stripes eget grundlag. Stripe, LLC (USA) står som aktiv deltager i EU-US Data Privacy Framework (tjekket 2. november 2026). |
| Resend (Plus Five Five, Inc.) | Sender mails fra os: login-links, kvitteringer og bekræftelser (køb, opsigelse, fortrydelse) og en bekræftelse, når en konto er slettet | Afsendelse fra EU-regionen i Irland. Kontodata, metadata og logs om mailene i USA. | Resend er et amerikansk selskab. På dataprivacyframework.gov står Resend 2. november 2026 som "Active - Re-certification under Review" (aktiv, fornyelsen er under behandling). Overførslen bygger derfor på EU's standardkontrakter i Resends databehandleraftale (resend.com/legal/dpa). Data Privacy Framework er et ekstra grundlag, så længe certificeringen står som aktiv. |
| Amazon Web Services EMEA SARL | Kører Clawcos AI, der er med i din Sky-plan (Claude Haiku 5.5 fra Anthropic gennem Amazon Bedrock), når du ikke bruger din egen AI. AWS modtager de dele af dit indhold, som modellen skal læse, og sender svaret tilbage. Ifølge AWS har modelleverandøren Anthropic ingen adgang til indholdet eller AWS' logs. | AWS' regioner i EU: Frankfurt, og gennem AWS' EU-profil også Stockholm, Milano, Spanien, Irland og Paris. Indholdet forlader ikke EU. | Selskabet er i EU, og behandlingen sker i EU. AWS' databehandlertillæg med EU's standardkontrakter er en del af AWS' vilkår. AWS oplyser, at selskabet er omfattet af Amazon.com, Inc.'s certificering under EU-US Data Privacy Framework. |

Der er ingen hostingleverandør på listen: din Clawco og vores database kører på vores egen server i Danmark. Vi bruger ingen ekstern fejlovervågning. Den eneste modeludbyder på dine vegne er AWS ovenfor, og kun når Clawcos AI, der er med i din plan, kører.

## Hvad der ikke er en underdatabehandler

**Din egen modeludbyder.** Bruger du din egen nøgle, vælger du selv udbyderen, og din instans sender dit indhold dertil efter din aftale med dem. I dag kan du vælge Anthropic (USA), OpenAI (USA), GitHub Copilot (GitHub, USA) eller OpenRouter (USA), eller en model, du selv kører (LM Studio eller Ollama). Det er dit valg og dit forhold til udbyderen. Bruger du i stedet Clawcos AI, der er med i din plan, er det AWS, der kører modellen som vores underdatabehandler (se listen).

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
| 2026-11-02 | Første udgave af listen. |
| 2026-11-02 | Listen genereres nu fra en datafil (samme leverandører, samme grundlag); datoen øverst udfyldt. |
| 2026-11-03 | Amazon Web Services EMEA SARL tilføjet: kører Clawcos AI, der er med i Sky-planerne, i AWS' EU-regioner. Behandlingen begynder tidligst 2026-12-03 for konti, der fandtes før denne udgave (30 dages varsel). |

## Spørgsmål

Skriv til kontakt@clawco.work. Selskab: Henrik Lambert (personligt drevet, uden selskab), CVR intet CVR-nummer (ikke momsregistreret; registreres når lovens grænse nås), Banevænget 13, 5270 Odense N, Danmark.
