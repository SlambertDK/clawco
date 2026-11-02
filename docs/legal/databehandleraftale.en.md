---
version: 0.1-udkast
dato: 2026-10-31
status: udkast
sprog: en
---
> UDKAST / DRAFT — skrevet af Claude 2026-10-31 som udkast til gennemlæsning af en advokat. Ikke juridisk rådgivning. Ikke offentliggjort.

Version 0.1-udkast · 2026-10-31

> English translation of the Danish draft. Written by Claude as a draft for review by a lawyer. Not legal advice. Not published. If the two versions differ, the Danish text is the master until a lawyer decides otherwise.

# Data Processing Agreement for Clawco Sky

The agreement is offered to customers who want one. It follows GDPR Art. 28 (verify). A lawyer may choose instead to use the standard clauses of the Danish Data Protection Agency or the European Commission under Art. 28(7)-(8) (verify).

## 1. The parties

**The customer:** [Kundens navn], [Kundens adresse], [Kundens e-mail] (the "customer").

**The processor:** Henrik Lambert (a private individual, no company), company no. no CVR number (not VAT-registered; registers when the legal threshold is reached), [Adresse], [Kontakt-e-mail] ("we").

This agreement is an annex to the Terms of Service for Clawco Sky. If the two disagree on the processing of personal data, this agreement prevails.

## 2. Roles

The customer is the controller of the personal data held in the customer's instance (the "content"). We are the processor for the content. For the customer's account data and payment we are the controller ourselves, see the Privacy Policy.

[Lawyer: if the customer is a private person using Clawco for purely personal purposes, GDPR may not apply at all to the customer's processing (Art. 2(2)(c)). The agreement is then a voluntary comfort, and it matters for customers who use Clawco for more than private use — verify.]

## 3. Instructions

We process the content only on the customer's documented instructions. The instruction is: provide Clawco Sky under the Terms and this agreement. The customer's use of the service is also an instruction. If we think an instruction breaks data protection rules, we tell the customer without undue delay.

We do not process the content for our own purposes. We do not sell it and do not use it to train models.

## 4. Confidentiality

Everyone at our company who could come near the content is bound by confidentiality. Our staff have no access to the content. The only way in is the customer's own switched-on, time-limited and logged "Lad support se med" ("let support look along") function. It is off by default.

## 5. Security

We have technical and organisational measures that fit the risk (Art. 32 — verify). The main ones are in Annex B. We may change them as long as security does not get worse.

## 6. Subprocessors

The customer gives general authorisation for the subprocessors on our public list, Subprocessors. We have an agreement with each of them with the same data protection obligations as in this agreement. We are liable for them.

We notify the customer by email at least 30 days before we add or replace a subprocessor. The customer may object within the 30 days if there is a good reason. If we cannot meet the objection, the customer may cancel the subscription at no extra cost, and we refund the unused part of the paid period [proposal].

If the customer uses their own model key, the chosen model provider is the customer's own supplier, not our subprocessor.

## 7. Transfers outside the EU

We host the content in the EU. If we transfer content to a country outside the EU, for example to a model provider under "included model", it only happens on a valid basis under GDPR Chapter V, for example standard contractual clauses (verify).

## 8. Assistance

We help the customer as far as we can with:

- answering data subjects' rights requests (Art. 12-22 — verify). The customer can download everything as a zip and delete it all.
- security, impact assessments and consulting the supervisory authority (Art. 32-36 — verify)

We may charge a reasonable fee for assistance that takes a lot of work [proposal].

## 9. Personal data breaches

If we discover a breach that affects the content, we notify the customer without undue delay and no later than [48] hours after we become aware of it (Art. 33(2) — verify). The notice describes what we know: what happened, which data and which instances are affected, and what we are doing about it.

## 10. Deletion and return

When the agreement ends, the customer can download everything as a zip for 30 days. After that we delete the instance and its data. Backups expire at the latest 30 days later. The customer can also delete at any time, see Deletion and export. On request we confirm the deletion in writing. Accounting records that we are obliged to keep are not covered.

## 11. Audit

The customer has the right to the information needed to show that we comply with the agreement, and to have an auditor review it. An audit is agreed at least 30 days ahead, takes place during working hours and does not disturb other customers. We may show an independent report or certificate instead, if we have one [proposal]. The customer cannot demand access to our subprocessors' data centres.

## 12. Term

The agreement applies as long as we process content for the customer, and ends with the subscription.

## 13. Governing law

Danish law. Venue [Retskreds].

## 14. Signature

The agreement is entered into by the customer's electronic acceptance in the account or by signature.

For the customer: [name, date]. For Henrik Lambert (a private individual, no company): [name, title, date].

## Annex A. Description of the processing

- **Purpose:** to provide Clawco Sky: host the customer's isolated instance, let the agent read and sort the customer's sources and show the result.
- **Nature:** storage, reading, sorting, display, backup, deletion. The instance sends excerpts to the model provider the customer has chosen.
- **Categories of data subjects:** the customer and members of the household, including children, and people mentioned in the customer's email, calendar and notes.
- **Categories of data:** whatever the customer connects: email, calendar, notes, news, messages, bills, contact details. May include sensitive data if the customer puts it in.
- **Duration:** as long as the subscription runs, plus time for export and backup (see section 10).

## Annex B. Security measures

- **Isolation:** one container and one volume per customer. No one shares an instance.
- **Encryption:** data at rest is encrypted. All traffic uses TLS. Model keys are held in an encrypted envelope per customer.
- **Network:** no instance has a public port. All access goes through our gateway, which checks sign-in at the entrance.
- **Logging without content:** logs and error reports never contain email text, messages or prompts.
- **Access control:** no staff access to content. Operations access needs a personal login and two-factor [confirm with operations]. Support can only get in through the customer's own permission, time-limited and logged.
- **Backups:** every night, kept for 30 days, in the EU.
- **Policy layer:** the agent cannot pay, write to others or delete without the customer's yes.
- **Contingency:** plan for breaches and recovery [to be written].
