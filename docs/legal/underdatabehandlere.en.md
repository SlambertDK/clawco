---
version: 1.3
dato: 2026-11-03
status: udgivet
sprog: en
---
Version 1.3 · 2026-11-03

> English translation of the Danish text. If the two versions differ, the Danish text applies.

# Subprocessors for Clawco Sky

Last updated: 2026-11-03

A subprocessor is a supplier that Henrik Lambert (a private individual, no company) uses to provide Clawco Sky and that comes into contact with personal data. This is the full list. It is public, so you can see who is involved.

The list belongs with the Privacy Policy and the Data Processing Agreement. The transfer bases were checked on 2 November 2026 against the official Data Privacy Framework list (dataprivacyframework.gov) and against the suppliers' own data processing agreements.

## The list

| Name | What they do | Where | Basis for transfer |
|---|---|---|---|
| Cloudflare, Inc. | Tunnel and DNS for clawco.work and the addresses under it. Encryption (TLS) ends at Cloudflare's edge, so Cloudflare can technically see the traffic to and from your Clawco there, content included. R2 for encrypted backups (built, not yet switched on). | The edge: Cloudflare's data centres, usually the nearest one. R2: EU jurisdiction. | Cloudflare is a US company. It is listed as an active participant in the EU-US Data Privacy Framework (checked 2 November 2026). Cloudflare's data processing agreement (cloudflare.com/cloudflare-customer-dpa/) also contains the EU Standard Contractual Clauses. |
| Stripe Payments Europe Ltd | Payment, subscription, invoices and VAT | Ireland | The company is in the EU. If the Stripe group transfers data to the USA, that rests on Stripe's own basis. Stripe, LLC (USA) is listed as an active participant in the EU-US Data Privacy Framework (checked 2 November 2026). |
| Resend (Plus Five Five, Inc.) | Sends emails from us: sign-in links, receipts and confirmations (purchase, cancellation, withdrawal) and a confirmation when an account is deleted | Sending from its EU region in Ireland. Account data, metadata and logs about the emails in the USA. | Resend is a US company. On dataprivacyframework.gov, Resend is listed on 2 November 2026 as "Active - Re-certification under Review". The transfer therefore rests on the EU Standard Contractual Clauses in Resend's data processing agreement (resend.com/legal/dpa). The Data Privacy Framework is an extra basis for as long as the certification is listed as active. |
| Amazon Web Services EMEA SARL | Runs Clawco's AI that is included in your Sky plan (Claude Haiku 5.5 from Anthropic through Amazon Bedrock), when you do not use your own AI. AWS receives the parts of your content that the model needs to read and sends the answer back. According to AWS, the model maker Anthropic has no access to the content or to AWS' logs. | AWS' regions in the EU: Stockholm, and through AWS' EU profile also Frankfurt, Milan, Spain, Ireland and Paris. The content does not leave the EU. | The company is in the EU, and the processing takes place in the EU. AWS' data processing addendum, with the EU Standard Contractual Clauses, is part of AWS' terms. AWS states that it is covered by Amazon.com, Inc.'s certification under the EU-US Data Privacy Framework. |

There is no hosting provider on the list: your Clawco and our database run on our own server in Denmark. We use no external error monitoring. The only model provider on your behalf is AWS above, and only when Clawco's AI that is included in your plan runs.

## What is not a subprocessor

**Your own model provider.** If you use your own key, you choose the provider yourself, and your instance sends your content there under your agreement with them. Today you can choose Anthropic (USA), OpenAI (USA), GitHub Copilot (GitHub, USA) or OpenRouter (USA), or a model you run yourself (LM Studio or Ollama). It is your choice and your relationship with the provider. If you use Clawco's AI that is included in your plan instead, AWS runs the model as our subprocessor (see the list).

**The services you connect yourself.** Your email, calendar, notes and news live with the providers you chose. Clawco reads them for you. They are not our suppliers.

**Your payment method.** Your bank or card company is not our subcontractor.

## Our promise to notify you

We do this every time the list changes:

- We write to you by email at least 30 days before a new subprocessor starts processing your data, or before we replace one.
- We say who it is, what they will do, where they are, and on what basis any transfer takes place.
- You can object within the 30 days if you have a good reason. If we cannot meet it, you can cancel the subscription at no extra cost. We refund what you have paid for the time after cancellation.
- We update the list and add a line to the change log below. The date at the top changes.

If it is urgent for security reasons, for example if a supplier drops out, we may switch faster. Then we write to you as soon as possible, and you have the same right to object.

We have a written agreement with each subprocessor. They have the same data protection requirements as we do (GDPR Art. 28(4)). We are liable for them towards you.

## Change log

| Date | Change |
|---|---|
| 2026-11-02 | First version of the list. |
| 2026-11-02 | The list is now generated from a data file (same suppliers, same bases); the date at the top filled in. |
| 2026-11-03 | Amazon Web Services EMEA SARL added: runs Clawco's AI included in the Sky plans, in AWS' EU regions. Processing starts no earlier than 2026-12-03 for accounts that existed before this version (30 days' notice). |
| 2026-11-03 | AWS' first region is Stockholm instead of Frankfurt (the same EU profile and the same six EU regions). |

## Questions

Write to kontakt@clawco.work. Company: Henrik Lambert (a private individual, no company), company no. no CVR number (not VAT-registered; registers when the legal threshold is reached), Banevænget 13, 5270 Odense N, Denmark.
