---
version: 0.1-udkast
dato: 2026-10-31
status: udkast
sprog: da
---
> UDKAST / DRAFT — skrevet af Claude 2026-10-31 som udkast til gennemlæsning af en advokat. Ikke juridisk rådgivning. Ikke offentliggjort.

Version 0.1-udkast · 2026-10-31

# Underdatabehandlere for Clawco Sky

Sidst opdateret: [dato]

En underdatabehandler er en leverandør, som Henrik Lambert (personligt drevet, uden selskab) bruger til at levere Clawco Sky, og som kommer i kontakt med personoplysninger. Her er den fulde liste. Den er offentlig, så du kan se, hvem der er med.

Listen hører til Privatlivspolitik og Databehandleraftale. Alle henvisninger til GDPR og andre regler skal verificeres.

## Listen

| Navn | Hvad de gør | Hvor | Overførselsgrundlag |
|---|---|---|---|
| Hetzner Online GmbH | Hosting af instanser, volumener og backup | Tyskland og Finland (Falkenstein, Helsinki) [bekræft] | Ingen overførsel uden for EU. Selskabet er i EU. |
| Cloudflare, Inc. | Tunnel og DNS for *.clawco.work (TLS afsluttes i Cloudflares kant); R2 til krypterede sikkerhedskopier | USA/EU (datalokalisering: [bekræft]) | SCC/DPF (verificér). **Til advokaten (KC-0212):** fordi TLS afsluttes i Cloudflares kant, ser Cloudflare trafikken til og fra din Clawco ukrypteret dér, også indhold. Vurdér om aftalen og standardkontrakterne dækker det, og om det skal stå i Privatlivspolitikken. |
| Stripe Payments Europe Ltd | Betaling, abonnement, fakturaer og moms | Irland [bekræft] | Selskabet er i EU. Hvis Stripe-koncernen overfører data til USA, bygger det på Stripes grundlag, fx standardkontrakter eller EU-US Data Privacy Framework — verificér |
| [E-mailudbyder] | Sender mails fra os: login-links, kvitteringer, påmindelser | [land i EU] | [Ingen overførsel, hvis udbyderen kun bruger EU — verificér] |
| [Fejlovervågning] | Modtager fejlrapporter uden indhold, så vi kan rette fejl | [EU-region] | [Hvis udbyderen er et selskab uden for EU: standardkontrakter — verificér] |
| [Modeludbydere] | Kun hvis du bruger tillægget "inkluderet model": læser de dele af dit indhold, modellen skal bruge, og svarer | [lande, fx USA — udfyldes] | [Standardkontrakter eller Data Privacy Framework — verificér. Krav om ingen lagring og ingen træning skal stå i aftalen] |
| [Stemmeudbyder] | Kun hvis stemmefunktionen tilbydes i Clawco Sky: omsætter tale og tekst | [land — udfyldes] | [verificér] |
| [DNS- og domæneudbyder] | Oversætter vores adresser til de rigtige servere. Ser kun, at nogen besøger siden. | [land — udfyldes] | [verificér] |

Rækker i firkantede klammer er ikke afklaret. De skal enten udfyldes eller fjernes, før listen offentliggøres. Rækker med "kun hvis" gælder kun, hvis du bruger den funktion.

## Hvad der ikke er en underdatabehandler

**Din egen modeludbyder.** Bruger du din egen nøgle, vælger du selv udbyderen, og din instans sender dit indhold dertil efter din aftale med dem. Det er dit valg og dit forhold til udbyderen.

**De tjenester, du selv kobler på.** Din mail, din kalender, dine noter og dine nyheder ligger hos de udbydere, du har valgt. Clawco læser dem for dig. De er ikke vores leverandører.

**Betalingsmetoden.** Din bank eller dit kortselskab er ikke vores underleverandør.

## Vores løfte om besked

Vi gør dette, hver gang listen ændres:

- Vi skriver til dig på e-mail mindst 30 dage, før en ny underdatabehandler begynder at behandle dine oplysninger, eller før vi skifter en ud.
- Vi skriver, hvem det er, hvad de skal gøre, hvor de er, og på hvilket grundlag en eventuel overførsel sker.
- Du kan gøre indsigelse inden for de 30 dage, hvis du har en saglig grund. Kan vi ikke imødekomme den, kan du sige abonnementet op uden ekstra omkostning. Vi refunderer det, du har betalt for tiden efter opsigelsen [forslag].
- Vi opdaterer listen og tilføjer en linje i ændringsloggen nedenfor. Datoen øverst ændres.

Haster det af hensyn til sikkerhed, fx hvis en leverandør falder fra, kan vi skifte hurtigere. Så skriver vi til dig så hurtigt som muligt, og du har samme ret til at gøre indsigelse.

Vi har en skriftlig aftale med hver underdatabehandler. De har samme krav til databeskyttelse som os (GDPR art. 28 — verificér). Vi hæfter for dem over for dig.

## Ændringslog

| Dato | Ændring |
|---|---|
| [dato] | Første udgave af listen. |

## Spørgsmål

Skriv til [Kontakt-e-mail]. Selskab: Henrik Lambert (personligt drevet, uden selskab), CVR intet CVR-nummer (ikke momsregistreret; registreres når lovens grænse nås), [Adresse].
