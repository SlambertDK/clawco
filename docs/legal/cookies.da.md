---
version: 0.1-udkast
dato: 2026-11-02
status: laest
sprog: da
---
> UDKAST / DRAFT — skrevet af Claude 2026-10-31, læst af ejeren (Henrik Lambert) 2026-11-02. Ikke juridisk rådgivning. Ikke offentliggjort.

Version 0.1-udkast · 2026-11-02

# Cookies på clawco.work og Clawco Sky

Gælder fra: [dato for offentliggørelse]

Kort sagt: clawco.work sætter ingen cookies. Når du logger ind, bruger vi kun de cookies, der skal til for at holde dig logget ind. Vi sporer dig ikke. Derfor har siden ingen cookiebanner.

## Hvad vi sætter

| Cookie | Hvad den gør | Hvornår | Hvor længe |
|---|---|---|---|
| `__Host-sky` | Husker, at du er logget ind på din konto (session) | Når du logger ind på konto.clawco.work | 30 dage, eller til du logger ud |
| `__Host-sky-binding` | Binder et login-link til den browser, du bad om det i | Når du beder om et login-link | 15 minutter |
| `__Host-sky-til` | Husker, hvilken side du skal tilbage til efter login | Når du logger ind fra en bestemt side | 15 minutter |
| `__Host-clawco` | Husker, at du er logget ind på din egen Clawco | Når du åbner din Clawco | 30 dage, eller til du logger ud. Koden i den skal fornyes hvert 15. minut. |

Det er alle. De er nødvendige for, at du kan logge ind og bruge tjenesten, og de bliver aldrig brugt til andet.

## Hvad en cookie er

En cookie er en lille tekstfil, som din browser gemmer, når du besøger en side. Cookien på din konto indeholder en tilfældig kode. Cookien på din Clawco indeholder en kortlivet, signeret kode med dit kontonummer og din e-mailadresse, så din Clawco ved, hvem der er logget ind. Ingen af dem indeholder dit indhold. De fortæller kun os og vores gateway, at det er dig, der er logget ind, så du ikke skal logge ind igen ved hvert klik.

## To adresser, samme regel

Cookierne sættes kun på de adresser, hvor du logger ind: konto.clawco.work og adressen til din egen Clawco, som også ligger under clawco.work. Selve clawco.work sætter ingen. Dine husstandsmedlemmer får deres egne cookies i deres egen browser. Hver cookie hører kun til præcis den adresse, der satte den, sendes kun over HTTPS (Secure), kan ikke læses af scripts på siden (HttpOnly) og sendes ikke med, når en anden side henter noget fra os i baggrunden (SameSite=Lax).

## Hvad vi ikke gør

- Vi bruger ingen cookies til statistik, reklamer eller sporing.
- Vi bruger ingen analyseværktøjer fra tredjepart på siden.
- Vi lader ikke andre sætte cookies via vores sider.
- Vi sælger ikke oplysninger om, hvordan du bruger siden.

Vi indsamler heller ingen brugsstatistik uden cookies, se Privatlivspolitik.

## Hvorfor der ikke er et banner

Danske regler kræver samtykke til cookies, der ikke er nødvendige (Cookiebekendtgørelsen, verificér). Cookierne ovenfor er nødvendige for den tjeneste, du selv beder om, og kræver ikke samtykke. Har vi ikke andre cookies, er der intet at spørge om. Vi oplyser dig her i stedet.

Hvis vi en dag vil bruge flere cookies, ændrer vi først denne side og indhenter dit samtykke.

## Hvis du blokerer cookierne

Blokerer du cookierne, kan du ikke blive logget ind, fordi tjenesten ikke kan huske dig fra den ene side til den næste. Den offentlige del af siden, som prisside og vilkår, virker stadig. Der er ingen anden måde at logge ind på, fordi vi ikke bruger adgangskoder eller sporing for at genkende dig.

## Når du betaler

Betalingen sker på en side, Stripe ejer. Stripe sætter sine egne cookies der, og de er Stripes ansvar. Se Stripes egen politik. Vi ser ikke Stripes cookies.

## Skrifttyper og andre eksterne ressourcer

clawco.work og kontosiderne på konto.clawco.work henter skrifttyper og andre filer fra vores egne adresser, ikke fra tredjeparter. Selve Clawco-appen i din instans henter skrifttyperne Inter og IBM Plex Mono fra Google Fonts. Google får derfor din IP-adresse, når appen indlæses. Google Fonts sætter ingen cookies.

## Sådan sletter du cookierne

Du kan logge ud i tjenesten. Så holder de op med at virke. Du kan også slette dem selv:

- **Chrome:** Indstillinger, Privatliv og sikkerhed, Slet browserdata, vælg Cookies.
- **Safari:** Indstillinger, Privatliv, Administrer webstedsdata, find clawco.work og vælg Fjern.
- **Firefox:** Indstillinger, Beskyttelse af privatlivet og sikkerhed, Cookies og webstedsdata, Administrer data.
- **Edge:** Indstillinger, Cookies og webstedstilladelser, Administrer og slet cookies.

Når du sletter dem, skal du logge ind igen med din passkey eller dit login-link. Menuernes navne kan afvige lidt mellem versioner.

## Ændringer

Vi skriver ændringer her og opdaterer versionslinjen øverst. Er ændringen væsentlig, giver vi besked i tjenesten, før den træder i kraft.

## Kontakt

Henrik Lambert (personligt drevet, uden selskab), CVR intet CVR-nummer (ikke momsregistreret; registreres når lovens grænse nås), Banevænget 13, 5270 Odense N, Danmark, kontakt@clawco.work. Læs også Privatlivspolitik.
