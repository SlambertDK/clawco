---
version: 0.1-udkast
dato: 2026-10-31
status: udkast
sprog: en
---
> UDKAST / DRAFT — skrevet af Claude 2026-10-31 som udkast til gennemlæsning af en advokat. Ikke juridisk rådgivning. Ikke offentliggjort.

Version 0.1-udkast · 2026-10-31

> English translation of the Danish draft. Written by Claude as a draft for review by a lawyer. Not legal advice. Not published. If the two versions differ, the Danish text is the master until a lawyer decides otherwise.

# Subprocessors for Clawco Sky

Last updated: [date]

A subprocessor is a supplier that Henrik Lambert (a private individual, no company) uses to provide Clawco Sky and that comes into contact with personal data. This is the full list. It is public, so you can see who is involved.

The list belongs with the Privacy Policy and the Data Processing Agreement. All references to GDPR and other rules must be verified.

## The list

| Name | What they do | Where | Basis for transfer |
|---|---|---|---|
| Hetzner Online GmbH | Hosting of instances, volumes and backups | Germany and Finland (Falkenstein, Helsinki) [confirm] | No transfer outside the EU. The company is in the EU. |
| Cloudflare, Inc. | Tunnel and DNS for *.clawco.work (TLS terminates at Cloudflare's edge); R2 for encrypted backups | USA/EU (data localisation: [confirm]) | SCC/DPF (verify). **For the lawyer (KC-0212):** because TLS terminates at Cloudflare's edge, Cloudflare sees the traffic to and from your Clawco unencrypted there, content included. Assess whether the agreement and the standard contractual clauses cover that, and whether the Privacy Policy must say so. |
| Stripe Payments Europe Ltd | Payment, subscription, invoices and VAT | Ireland [confirm] | The company is in the EU. If the Stripe group transfers data to the USA, that rests on Stripe's own basis, for example standard contractual clauses or the EU-US Data Privacy Framework — verify |
| [E-mailudbyder] | Sends emails from us: sign-in links, receipts, reminders | [EU country] | [No transfer if the provider uses the EU only — verify] |
| [Fejlovervågning] | Receives error reports without content, so we can fix faults | [EU region] | [If the provider is a company outside the EU: standard contractual clauses — verify] |
| [Modeludbydere] | Only if you use the "included model" add-on: reads the parts of your content the model needs and answers | [countries, for example USA — to be filled in] | [Standard contractual clauses or Data Privacy Framework — verify. A requirement of no storage and no training must be in the agreement] |
| [Voice provider] | Only if the voice feature is offered in Clawco Sky: converts speech and text | [country — to be filled in] | [verify] |
| [DNS and domain provider] | Translates our addresses into the right servers. Only sees that someone visits the site. | [country — to be filled in] | [verify] |

Rows in square brackets are not settled. They must be filled in or removed before the list is published. Rows marked "only if" apply only if you use that feature.

## What is not a subprocessor

**Your own model provider.** If you use your own key, you choose the provider yourself, and your instance sends your content there under your agreement with them. It is your choice and your relationship with the provider.

**The services you connect yourself.** Your email, calendar, notes and news live with the providers you chose. Clawco reads them for you. They are not our suppliers.

**Your payment method.** Your bank or card company is not our subcontractor.

## Our promise to notify you

We do this every time the list changes:

- We write to you by email at least 30 days before a new subprocessor starts processing your data, or before we replace one.
- We say who it is, what they will do, where they are, and on what basis any transfer takes place.
- You can object within the 30 days if you have a good reason. If we cannot meet it, you can cancel the subscription at no extra cost. We refund what you have paid for the time after cancellation [proposal].
- We update the list and add a line to the change log below. The date at the top changes.

If it is urgent for security reasons, for example if a supplier drops out, we may switch faster. Then we write to you as soon as possible, and you have the same right to object.

We have a written agreement with each subprocessor. They have the same data protection requirements as we do (GDPR Art. 28 — verify). We are liable for them towards you.

## Change log

| Date | Change |
|---|---|
| [date] | First version of the list. |

## Questions

Write to [Kontakt-e-mail]. Company: Henrik Lambert (a private individual, no company), company no. no CVR number (not VAT-registered; registers when the legal threshold is reached), [Adresse].
