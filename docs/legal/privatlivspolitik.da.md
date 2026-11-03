---
version: 1.1
dato: 2026-11-03
status: udgivet
sprog: da
---
Version 1.1 · 2026-11-03

# Privatlivspolitik for Clawco Sky

Gælder fra: 2026-11-03

Her står, hvilke oplysninger vi behandler, hvorfor, hvem der kan se dem, og hvad du kan gøre. Politikken følger GDPR art. 13 og 14. Den gælder for Clawco Sky, ikke for Clawco, du kører selv.

## 1. Hvem er ansvarlig

Henrik Lambert (personligt drevet, uden selskab), CVR intet CVR-nummer (ikke momsregistreret; registreres når lovens grænse nås), Banevænget 13, 5270 Odense N, Danmark, kontakt@clawco.work er dataansvarlig for dine kontooplysninger og betalingsstatus. Databeskyttelsesrådgiver: ikke udpeget.

Dit indhold i instansen er en særlig sag, se afsnit 3.

## 2. Hvad vi behandler om dig

**Kontooplysninger.** Din e-mailadresse, dit land og dit sprog, hvilke versioner af vilkår og privatlivspolitik du har sagt ja til og hvornår, den offentlige del af din passkey, de enheder du er logget ind på, dit abonnement og din betalingsstatus. Kortoplysninger ligger hos Stripe, ikke hos os. Hvis du er i en husstand, kan de andre medlemmer se dit navn.

**Tekniske oplysninger.** Når du logger ind og bruger tjenesten, ser vores systemer fx din IP-adresse og tidspunkter. Vi bruger dem til drift og sikkerhed. Din IP-adresse gemmer vi ikke i klartekst: for at bremse misbrug tæller vi loginforsøg på en hash af adressen og sletter tællingen efter et døgn. Vores serverlogs indeholder hverken din IP-adresse eller dit indhold, og vi gemmer dem i højst 30 dage. Vi bruger ingen ekstern fejlovervågning; fejl skrives kun i vores egne serverlogs, og de indeholder aldrig dine beskeder, mailtekster eller prompts.

**Brugsmønstre.** Vi indsamler ingen brugsstatistik. Kommer der en dag anonyme tal om, hvordan produktet bruges, sker det kun, hvis du selv slår det til, og du kan slå det fra igen når som helst.

**Mails fra os.** Vi sender de mails, du har brug for: login-link, en kvittering, når du køber, en bekræftelse, når du siger op eller fortryder, en besked, når du har slået “Lad support se med” til, og en bekræftelse, når du sletter din konto. Skal vi fortælle dig om en vigtig ændring, skriver vi også til dig. Vi sender ingen påmindelser om prøveperiode eller fornyelse endnu. Nyhedsbreve og tilbud sender vi kun, hvis du har sagt ja.

## 3. Dit indhold i din instans

Du kan koble din mail, din kalender, dine noter og andet til Clawco. Det er dit indhold. Vi behandler det kun for at levere tjenesten til dig, inde i din egen isolerede instans. Derudover gælder:

- Vi læser det ikke. Vores support kommer kun ind, hvis du som ejer selv slår “Lad support se med” til i 1, 4 eller 24 timer; det er slået fra, indtil du gør det. Imens kan én fra support se det samme som dig, men ikke ændre noget, hvert kig logges, og du kan slå det fra når som helst. Ellers ser vi kun det, du selv sender til kontakt@clawco.work.
- Den, der driver serveren, har teknisk adgang til dens diske, og i beta er diskene endnu ikke krypteret i hvile. Den adgang bruger vi kun til drift, aldrig til at læse dit indhold.
- Vi sælger det ikke.
- Vi bruger det ikke til at træne modeller, hverken vores egne eller andres.
- Vi sender det ikke videre, ud over hvad der står i afsnit 5.

Rollefordelingen er: du bestemmer, hvad du kobler til, og vi er databehandler for indholdet. Hvis du ønsker en databehandleraftale, kan du få en. Bruger du Clawco til rent personlige formål, gælder databeskyttelsesforordningen måske ikke for din egen behandling (husholdningsundtagelsen i GDPR art. 2(2)(c)), men den gælder altid for os.

Din instans sender de dele af dit indhold, som modellen skal læse, til den modeludbyder, du har valgt med din egen nøgle: i dag Anthropic (USA), OpenAI (USA), GitHub Copilot (GitHub, USA) eller OpenRouter (USA), eller en model, du selv kører (LM Studio eller Ollama). Det sker efter din aftale med udbyderen. Bruger du i stedet Clawcos AI, der er med i din Sky-plan, sender din instans de samme dele til Amazon Web Services i EU, som kører modellen for os (se afsnit 5).

## 4. Hvorfor vi må behandle oplysningerne

- **Kontrakt** (GDPR art. 6(1)(b)): konto, abonnement, drift af din instans og betaling.
- **Berettiget interesse** (art. 6(1)(f)): sikkerhed, fejlfinding og misbrugsforebyggelse. Vi vejer det mod dine rettigheder.
- **Retlig forpligtelse** (art. 6(1)(c)): regnskab, jf. Bogføringsloven § 12.
- **Samtykke** (art. 6(1)(a)): markedsføringsmails og, hvis de en dag kommer, anonyme brugsmønstre. Du kan trække samtykket tilbage, uden at det påvirker det, der er sket før.


## 5. Hvem får oplysningerne

Vi bruger disse underdatabehandlere (den fulde liste står i Underdatabehandlere):

- Cloudflare, Inc. (USA): tunnel og DNS for clawco.work og din instans. Krypteringen (TLS) afsluttes i Cloudflares kant, så Cloudflare kan teknisk se trafikken til og fra din Clawco dér, også indhold.
- Stripe Payments Europe Ltd (Irland): betaling, abonnement og moms
- Resend, Inc. (USA): sender mails fra os fra EU-regionen i Irland. Resend gemmer kontodata, metadata og logs om mailene i USA.
- Amazon Web Services EMEA SARL (Luxembourg): kører Clawcos AI, der er med i din plan (Claude Haiku 5.5 gennem Amazon Bedrock), i AWS' regioner i EU. Kun når du ikke bruger din egen AI. For konti fra før 2026-11-03 begynder det tidligst 2026-12-03.

Vi bruger ingen ekstern fejlovervågning. Den eneste modeludbyder på dine vegne er AWS, og kun for Clawcos AI, der er med i din plan. Din instans ligger på vores egen server i Danmark.

Vi giver kun oplysninger videre til myndigheder, hvis loven kræver det.

## 6. Overførsel uden for EU

Vi gemmer dit indhold og dine kontooplysninger i EU. Nogle af vores leverandører er selskaber i USA eller har moderselskaber der. Hvis en overførsel sker, bygger den på et gyldigt grundlag efter GDPR kapitel V: EU-US Data Privacy Framework, når modtageren står som aktiv deltager, ellers EU's standardkontrakter (SCC). Pr. leverandør, tjekket 2. november 2026 mod dataprivacyframework.gov: Cloudflare, Inc. står som aktiv deltager, og Cloudflares databehandleraftale indeholder desuden EU's standardkontrakter. Resend (Plus Five Five, Inc.) står som "Active - Re-certification under Review" (aktiv, fornyelsen er under behandling); derfor bygger overførslen på EU's standardkontrakter i Resends databehandleraftale. Stripe Payments Europe er i Irland; Stripe, LLC (USA) står som aktiv deltager, og Stripe-koncernens overførsler til USA bygger på Stripes eget grundlag. Din egen modeludbyder er dit eget valg efter din aftale med dem.

## 7. Hvor længe vi gemmer

- Kontooplysninger: mens kontoen findes. Når du sletter kontoen, fjerner vi med det samme din e-mailadresse, dit land, dit sprog, dine passkeys og dine sessioner. Tilbage er et kontonummer uden e-mail og det, regnskabet kræver.
- Dit indhold: til du sletter kontoen. Så stopper instansen, og data slettes, se Sletning og eksport.
- Backup: højst 30 dage. Slettet indhold forsvinder fra backup inden for 30 dage. I beta er sikkerhedskopier endnu ikke slået til.
- Regnskabsbilag (fakturaer): 5 år efter udgangen af regnskabsåret (Bogføringsloven § 12).
- Tekniske logs: højst 30 dage. Tællingen af loginforsøg (en hash af IP-adressen): et døgn.

## 8. Dine rettigheder

Du har ret til:

- **indsigt** i, hvad vi har om dig (art. 15)
- **berigtigelse** af forkerte oplysninger (art. 16)
- **sletning** (art. 17), som du selv kan gøre i din konto
- **begrænsning** af behandlingen (art. 18)
- **dataportabilitet** (art. 20): du kan hente alt som en zip-fil
- **indsigelse** mod behandling, der bygger på berettiget interesse (art. 21)
- at **trække samtykke tilbage**

Skriv til kontakt@clawco.work. Vi svarer inden for en måned. Er du utilfreds, kan du klage til Datatilsynet (datatilsynet.dk).

## 9. Børn

Clawco Sky er for personer fra 18 år. Børn kan ikke tilføjes som medlemmer endnu. Kommer det, opdaterer vi denne politik først. I Danmark er børn under 15 år for unge til selv at give samtykke til en onlinetjeneste (Databeskyttelsesloven § 6, stk. 2 og 3, jf. GDPR art. 8); her skal den, der har forældremyndigheden, samtykke.

## 10. Automatiske afgørelser

Vi træffer ingen afgørelser, der har retsvirkning for dig, alene ved hjælp af automatisk behandling (GDPR art. 22). Agentens forslag bekræftes altid af et menneske, før noget sker. Og agenten betaler, skriver til andre og sletter aldrig uden dit ja.

## 11. Ændringer og kontakt

Vi varsler væsentlige ændringer på e-mail mindst 30 dage før. Spørgsmål: kontakt@clawco.work, Banevænget 13, 5270 Odense N, Danmark. Databeskyttelsesrådgiver: ikke udpeget.
