---
version: 0.1-udkast
dato: 2026-11-02
status: laest
sprog: da
---
> UDKAST / DRAFT — skrevet af Claude 2026-10-31, læst af ejeren (Henrik Lambert) 2026-11-02. Ikke juridisk rådgivning. Ikke offentliggjort.

Version 0.1-udkast · 2026-11-02

# Privatlivspolitik for Clawco Sky

Gælder fra: [dato for offentliggørelse]

Her står, hvilke oplysninger vi behandler, hvorfor, hvem der kan se dem, og hvad du kan gøre. Politikken følger GDPR art. 13 og 14 (verificér). Den gælder for Clawco Sky, ikke for Clawco, du kører selv.

## 1. Hvem er ansvarlig

Henrik Lambert (personligt drevet, uden selskab), CVR intet CVR-nummer (ikke momsregistreret; registreres når lovens grænse nås), Banevænget 13, 5270 Odense N, Danmark, kontakt@clawco.work er dataansvarlig for dine kontooplysninger og betalingsstatus. Databeskyttelsesrådgiver: ikke udpeget.

Dit indhold i instansen er en særlig sag, se afsnit 3.

## 2. Hvad vi behandler om dig

**Kontooplysninger.** Din e-mailadresse, dit land og dit sprog, hvilke versioner af vilkår og privatlivspolitik du har sagt ja til og hvornår, den offentlige del af din passkey, de enheder du er logget ind på, dit abonnement og din betalingsstatus. Kortoplysninger ligger hos Stripe, ikke hos os. Hvis du er i en husstand, kan de andre medlemmer se dit navn.

**Tekniske oplysninger.** Når du logger ind og bruger tjenesten, ser vores systemer fx din IP-adresse og tidspunkter. Vi bruger dem til drift og sikkerhed. Din IP-adresse gemmer vi ikke i klartekst: for at bremse misbrug tæller vi loginforsøg på en hash af adressen og sletter tællingen efter et døgn. Vores serverlogs indeholder hverken din IP-adresse eller dit indhold, og vi gemmer dem i højst 30 dage. Vi bruger ingen ekstern fejlovervågning; fejl skrives kun i vores egne serverlogs, og de indeholder aldrig dine beskeder, mailtekster eller prompts.

**Brugsmønstre.** Vi indsamler ingen brugsstatistik. Kommer der en dag anonyme tal om, hvordan produktet bruges, sker det kun, hvis du selv slår det til, og du kan slå det fra igen når som helst.

**Mails fra os.** Vi sender de mails, du har brug for: login-link, kvitteringer, påmindelser om prøveperiode og fornyelse og vigtige ændringer. Nyhedsbreve og tilbud sender vi kun, hvis du har sagt ja.

## 3. Dit indhold i din instans

Du kan koble din mail, din kalender, dine noter og andet til Clawco. Det er dit indhold. Vi behandler det kun for at levere tjenesten til dig, inde i din egen isolerede instans. Derudover gælder:

- Vi læser det ikke. Der findes ingen supportfunktion, der giver os adgang til din instans. Har du brug for hjælp, skriver du til kontakt@clawco.work, og vi ser kun det, du selv sender.
- Den, der driver serveren, har teknisk adgang til dens diske, og i beta er diskene endnu ikke krypteret i hvile. Den adgang bruger vi kun til drift, aldrig til at læse dit indhold.
- Vi sælger det ikke.
- Vi bruger det ikke til at træne modeller, hverken vores egne eller andres.
- Vi sender det ikke videre, ud over hvad der står i afsnit 5.

Rollefordelingen er: du bestemmer, hvad du kobler til, og vi er databehandler for indholdet. Hvis du ønsker en databehandleraftale, kan du få en. Bruger du Clawco til rent personlige formål, gælder databeskyttelsesforordningen måske ikke for din egen behandling (husholdningsundtagelsen i GDPR art. 2(2)(c)), men den gælder altid for os.

Din instans sender de dele af dit indhold, som modellen skal læse, til den modeludbyder, du har valgt med din egen nøgle: i dag Anthropic (USA), OpenAI (USA), GitHub Copilot (GitHub, USA) eller OpenRouter (USA), eller en model, du selv kører (LM Studio eller Ollama). Det sker efter din aftale med udbyderen.

## 4. Hvorfor vi må behandle oplysningerne

- **Kontrakt** (GDPR art. 6(1)(b)): konto, abonnement, drift af din instans og betaling.
- **Berettiget interesse** (art. 6(1)(f)): sikkerhed, fejlfinding og misbrugsforebyggelse. Vi vejer det mod dine rettigheder.
- **Retlig forpligtelse** (art. 6(1)(c)): regnskab, jf. Bogføringsloven (verificér).
- **Samtykke** (art. 6(1)(a)): markedsføringsmails og, hvis de en dag kommer, anonyme brugsmønstre. Du kan trække samtykket tilbage, uden at det påvirker det, der er sket før.

Alle artikelhenvisninger i dette afsnit: verificér.

## 5. Hvem får oplysningerne

Vi bruger disse underdatabehandlere (den fulde liste står i Underdatabehandlere):

- Cloudflare, Inc. (USA): tunnel og DNS for clawco.work og din instans. Krypteringen (TLS) afsluttes i Cloudflares kant, så Cloudflare kan teknisk se trafikken til og fra din Clawco dér, også indhold.
- Stripe Payments Europe Ltd (Irland): betaling, abonnement og moms
- Resend, Inc. (USA): sender mails fra os fra EU-regionen i Irland. Resend gemmer kontodata, metadata og logs om mailene i USA.

Vi bruger ingen ekstern fejlovervågning og ingen modeludbyder på dine vegne: tillægget "inkluderet model" findes ikke endnu. Din instans ligger på vores egen server i Danmark.

Vi giver kun oplysninger videre til myndigheder, hvis loven kræver det.

## 6. Overførsel uden for EU

Vi gemmer dit indhold og dine kontooplysninger i EU. Nogle af vores leverandører er selskaber i USA eller har moderselskaber der. Hvis en overførsel sker, bygger den på et gyldigt grundlag, fx EU's standardkontrakter (SCC) eller EU-US Data Privacy Framework (GDPR kap. V — verificér). Pr. leverandør: Cloudflare og Resend er amerikanske selskaber og overfører på standardkontrakter og Data Privacy Framework; Stripe Payments Europe er i Irland, og Stripe-koncernens overførsler til USA bygger på Stripes eget grundlag. Din egen modeludbyder er dit eget valg efter din aftale med dem.

## 7. Hvor længe vi gemmer

- Kontooplysninger: mens kontoen findes. Når du sletter kontoen, fjerner vi med det samme din e-mailadresse, dit land, dit sprog, dine passkeys og dine sessioner. Tilbage er et kontonummer uden e-mail og det, regnskabet kræver.
- Dit indhold: til du sletter kontoen. Så stopper instansen, og data slettes, se Sletning og eksport.
- Backup: højst 30 dage. Slettet indhold forsvinder fra backup inden for 30 dage. I beta er sikkerhedskopier endnu ikke slået til.
- Regnskabsbilag (fakturaer): 5 år efter udgangen af regnskabsåret (Bogføringsloven — verificér).
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

Skriv til kontakt@clawco.work. Vi svarer inden for en måned. Er du utilfreds, kan du klage til Datatilsynet (datatilsynet.dk). Alle artikelhenvisninger: verificér.

## 9. Børn

Clawco Sky er for personer fra 13 år. Et barn kan være medlem af en husstand, men kun hvis en forælder eller en anden med forældremyndighed samtykker på barnets vegne (Databeskyttelsesloven §6, GDPR art. 8 — verificér). Det er kunden, der bekræfter samtykket, når barnet tilføjes. Forælderen kan til enhver tid trække det tilbage og få barnets oplysninger slettet. Et barn under 13 kan ikke oprette en konto selv.

## 10. Automatiske afgørelser

Vi træffer ingen afgørelser, der har retsvirkning for dig, alene ved hjælp af automatisk behandling (GDPR art. 22 — verificér). Agentens forslag bekræftes altid af et menneske, før noget sker. Og agenten betaler, skriver til andre og sletter aldrig uden dit ja.

## 11. Ændringer og kontakt

Vi varsler væsentlige ændringer på e-mail mindst 30 dage før. Spørgsmål: kontakt@clawco.work, Banevænget 13, 5270 Odense N, Danmark. Databeskyttelsesrådgiver: ikke udpeget.
