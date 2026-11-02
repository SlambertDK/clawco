---
version: 0.1-udkast
dato: 2026-11-02
status: laest
sprog: en
---
> UDKAST / DRAFT — skrevet af Claude 2026-10-31, læst af ejeren (Henrik Lambert) 2026-11-02. Ikke juridisk rådgivning. Ikke offentliggjort.

Version 0.1-udkast · 2026-11-02

> English translation of the Danish draft, written by Claude and read by the owner (Henrik Lambert) on 2026-11-02. Not legal advice. Not published. If the two versions differ, the Danish text applies.

# Privacy Policy for Clawco Sky

Effective from: [date of publication]

This page says what information we process, why, who can see it, and what you can do. The policy follows GDPR Art. 13 and 14. It applies to Clawco Sky, not to a Clawco you run yourself.

## 1. Who is responsible

Henrik Lambert (a private individual, no company), company no. no CVR number (not VAT-registered; registers when the legal threshold is reached), Banevænget 13, 5270 Odense N, Denmark, kontakt@clawco.work is the controller of your account information and payment status. Data protection officer: not appointed.

Your content in the instance is a special case, see section 3.

## 2. What we process about you

**Account data.** Your email address, your country and your language, which versions of the terms and the privacy policy you said yes to and when, the public part of your passkey, the devices you are signed in on, your subscription and your payment status. Card details are held by Stripe, not by us. If you are in a household, the other members can see your name.

**Technical data.** When you sign in and use the service, our systems see for example your IP address and timestamps. We use them for operations and security. We do not store your IP address in plain text: to slow down abuse we count sign-in attempts against a hash of the address and delete the count after a day. Our server logs contain neither your IP address nor your content, and we keep them for at most 30 days. We use no external error monitoring; errors are written only to our own server logs, and they never contain your messages, email text or prompts.

**Usage patterns.** We collect no usage statistics. If anonymous figures about how the product is used ever come, it will only happen if you switch it on yourself, and you can switch it off again at any time.

**Emails from us.** We send the emails you need: sign-in links, a receipt when you buy, a confirmation when you cancel or withdraw, and a confirmation when you delete your account. If we need to tell you about an important change, we write to you as well. We do not yet send reminders about the trial or renewal. We send newsletters and offers only if you have said yes.

## 3. Your content in your instance

You can connect your email, calendar, notes and more to Clawco. It is your content. We process it only to provide the service to you, inside your own isolated instance. In addition:

- We do not read it. There is no support feature that gives us access to your instance. If you need help, you write to kontakt@clawco.work, and we see only what you send yourself.
- Whoever runs the server has technical access to its disks, and in beta the disks are not yet encrypted at rest. We use that access only for operations, never to read your content.
- We do not sell it.
- We do not use it to train models, neither ours nor anyone else's.
- We do not pass it on, beyond what section 5 says.

The split of roles is: you decide what you connect, and we are the processor for the content. If you want a data processing agreement, you can have one. If you use Clawco for purely personal purposes, the GDPR may not apply to your own processing (the household exemption in GDPR Art. 2(2)(c)), but it always applies to us.

Your instance sends the parts of your content that the model needs to read to the model provider you have chosen with your own key: today Anthropic (USA), OpenAI (USA), GitHub Copilot (GitHub, USA) or OpenRouter (USA), or a model you run yourself (LM Studio or Ollama). That happens under your agreement with the provider.

## 4. Why we may process the information

- **Contract** (GDPR Art. 6(1)(b)): account, subscription, running your instance and payment.
- **Legitimate interest** (Art. 6(1)(f)): security, troubleshooting and abuse prevention. We weigh it against your rights.
- **Legal obligation** (Art. 6(1)(c)): bookkeeping, see section 12 of the Danish Bookkeeping Act.
- **Consent** (Art. 6(1)(a)): marketing emails and, if they ever come, anonymous usage patterns. You can withdraw consent without affecting what happened before.


## 5. Who receives the information

We use these subprocessors (the full list is in Subprocessors):

- Cloudflare, Inc. (USA): tunnel and DNS for clawco.work and your instance. Encryption (TLS) ends at Cloudflare's edge, so Cloudflare can technically see the traffic to and from your Clawco there, content included.
- Stripe Payments Europe Ltd (Ireland): payment, subscription and VAT
- Resend, Inc. (USA): sends emails from us from its EU region in Ireland. Resend keeps account data, metadata and logs about the emails in the USA.

We use no external error monitoring and no model provider on your behalf: the "included model" add-on does not exist yet. Your instance runs on our own server in Denmark.

We only pass information to public authorities if the law requires it.

## 6. Transfers outside the EU

We store your content and account data in the EU. Some of our suppliers are companies in the USA or have parent companies there. If a transfer takes place, it rests on a valid basis under GDPR Chapter V: the EU-US Data Privacy Framework when the recipient is listed as an active participant, otherwise the EU Standard Contractual Clauses (SCC). Per supplier, checked on 2 November 2026 against dataprivacyframework.gov: Cloudflare, Inc. is listed as an active participant, and Cloudflare's data processing agreement also contains the EU Standard Contractual Clauses. Resend (Plus Five Five, Inc.) is listed as "Active - Re-certification under Review"; the transfer therefore rests on the EU Standard Contractual Clauses in Resend's data processing agreement. Stripe Payments Europe is in Ireland; Stripe, LLC (USA) is listed as an active participant, and the Stripe group's transfers to the USA rest on Stripe's own basis. Your own model provider is your own choice under your agreement with them.

## 7. How long we keep it

- Account data: while the account exists. When you delete the account, we remove your email address, your country, your language, your passkeys and your sessions at once. What remains is an account number without an email address, and what the bookkeeping requires.
- Your content: until you delete the account. Then the instance stops and the data is deleted, see Deletion and export.
- Backups: at most 30 days. Deleted content disappears from backups within 30 days. In beta, backups are not yet switched on.
- Accounting records (invoices): 5 years after the end of the financial year (Bookkeeping Act section 12).
- Technical logs: at most 30 days. The count of sign-in attempts (a hash of the IP address): one day.

## 8. Your rights

You have the right to:

- **access** what we hold about you (Art. 15)
- **rectification** of wrong information (Art. 16)
- **erasure** (Art. 17), which you can do yourself in your account
- **restriction** of processing (Art. 18)
- **data portability** (Art. 20): you can download everything as a zip file
- **object** to processing based on legitimate interest (Art. 21)
- **withdraw consent**

Write to kontakt@clawco.work. We answer within one month. If you are not satisfied, you can complain to the Danish Data Protection Agency, Datatilsynet (datatilsynet.dk).

## 9. Children

Clawco Sky is for people aged 18 and over. Children cannot be added as members yet. If that comes, we update this policy first. In Denmark, children under 15 are too young to give their own consent to an online service (Data Protection Act section 6(2) and (3), cf. GDPR Art. 8); there, the person with parental responsibility must consent.

## 10. Automated decisions

We make no decisions with legal effect on you based solely on automated processing (GDPR Art. 22). The agent's suggestions are always confirmed by a human before anything happens. And the agent never pays, writes to others or deletes without your yes.

## 11. Changes and contact

We announce material changes by email at least 30 days ahead. Questions: kontakt@clawco.work, Banevænget 13, 5270 Odense N, Denmark. Data protection officer: not appointed.
