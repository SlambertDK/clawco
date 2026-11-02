---
version: 1.0
dato: 2026-11-02
status: udgivet
sprog: en
---
Version 1.0 · 2026-11-02

> English translation of the Danish text. If the two versions differ, the Danish text applies.

# Data Processing Agreement for Clawco Sky

The agreement is offered to customers who want one. It follows GDPR Art. 28.

## 1. The parties

**The customer:** [Kundens navn], [Kundens adresse], [Kundens e-mail] (the "customer").

**The processor:** Henrik Lambert (a private individual, no company), company no. no CVR number (not VAT-registered; registers when the legal threshold is reached), Banevænget 13, 5270 Odense N, Denmark, kontakt@clawco.work ("we").

This agreement is an annex to the Terms of Service for Clawco Sky. If the two disagree on the processing of personal data, this agreement prevails.

## 2. Roles

The customer is the controller of the personal data held in the customer's instance (the "content"). We are the processor for the content. For the customer's account data and payment we are the controller ourselves, see the Privacy Policy.

If the customer uses Clawco for purely personal purposes, the GDPR may not apply at all to the customer's own processing (Art. 2(2)(c)). The agreement is then a voluntary comfort. It matters for customers who use Clawco for more than private use.

## 3. Instructions

We process the content only on the customer's documented instructions. The instruction is: provide Clawco Sky under the Terms and this agreement. The customer's use of the service is also an instruction. If we think an instruction breaks data protection rules, we tell the customer without undue delay.

We do not process the content for our own purposes. We do not sell it and do not use it to train models.

## 4. Confidentiality

Everyone at our company who could come near the content is bound by confidentiality. We do not read the content. Support gets in only if the customer, as owner, turns on “Lad support se med” for 1, 4 or 24 hours; while it is on, one person from support sees what the customer sees but cannot change anything, and every look is logged. Whoever runs the server has technical access to its disks, and in beta the disks are not yet encrypted at rest. That access is used only for operations.

## 5. Security

We have technical and organisational measures that fit the risk (Art. 32). The main ones are in Annex B. We may change them as long as security does not get worse.

## 6. Subprocessors

The customer gives general authorisation for the subprocessors on our public list, Subprocessors. We have an agreement with each of them with the same data protection obligations as in this agreement. We are liable for them.

We notify the customer by email at least 30 days before we add or replace a subprocessor. The customer may object within the 30 days if there is a good reason. If we cannot meet the objection, the customer may cancel the subscription at no extra cost, and we refund the unused part of the paid period.

If the customer uses their own model key, the chosen model provider is the customer's own supplier, not our subprocessor.

## 7. Transfers outside the EU

We host the content in the EU, on our own server in Denmark. Traffic to and from the instance passes through Cloudflare, Inc. (USA), where encryption (TLS) ends, see Subprocessors. If we transfer content to a country outside the EU, it only happens on a valid basis under GDPR Chapter V, for example standard contractual clauses. For Cloudflare, Inc. and Resend (Plus Five Five, Inc.) the basis is stated in Subprocessors.

## 8. Assistance

We help the customer as far as we can with:

- answering data subjects' rights requests (Art. 12-22). The customer can download everything as a zip ("Hent alt") and delete their account.
- security, impact assessments and consulting the supervisory authority (Art. 32-36)

We may charge a reasonable fee for assistance that takes a lot of work.

## 9. Personal data breaches

If we discover a breach that affects the content, we notify the customer without undue delay and no later than 48 hours after we become aware of it. The law requires notice without undue delay (Art. 33(2)); the 48 hours are our own commitment. The notice describes what we know: what happened, which data and which instances are affected, and what we are doing about it.

## 10. Deletion and return

When the agreement ends, the customer can download everything as a zip for 30 days. After that we delete the instance and its data. If the customer deletes their account themselves, that happens at once. Backups expire at the latest 30 days later (in beta they are not yet switched on). The customer can also delete at any time, see Deletion and export. On request we confirm the deletion in writing. Accounting records that we are obliged to keep are not covered.

## 11. Audit

The customer has the right to the information needed to show that we comply with the agreement, and to have an auditor review it. An audit is agreed at least 30 days ahead, takes place during working hours and does not disturb other customers. Today we have no independent report or certification. If we get one, we may show it instead. The customer cannot demand access to our subprocessors' data centres.

## 12. Term

The agreement applies as long as we process content for the customer, and ends with the subscription.

## 13. Governing law

Danish law. Venue the District Court of Odense (Retten i Odense).

## 14. Signature

The agreement is entered into by the customer's electronic acceptance in the account or by signature.

For the customer: [name, date]. For Henrik Lambert (a private individual, no company): [name, title, date].

## Annex A. Description of the processing

- **Purpose:** to provide Clawco Sky: host the customer's isolated instance, let the agent read and sort the customer's sources and show the result.
- **Nature:** storage, reading, sorting, display, backup, deletion. The instance sends excerpts to the model provider the customer has chosen.
- **Categories of data subjects:** the customer and people mentioned in the customer's email, calendar and notes, for example the customer's household and children.
- **Categories of data:** whatever the customer connects: email, calendar, notes, news, messages, bills, contact details. May include sensitive data if the customer puts it in.
- **Duration:** as long as the subscription runs, plus time for export and backup (see section 10).

## Annex B. Security measures

- **Isolation:** one container and one volume per customer. No one shares an instance.
- **Encryption:** all traffic uses TLS up to Cloudflare's edge and from there an encrypted tunnel to the server. Model keys are held in an encrypted file per customer, and each customer has its own data key. In beta the disks are not yet encrypted at rest.
- **Network:** no instance has a public port. All access goes through our gateway, which checks sign-in at the entrance.
- **Logging without content:** logs and error reports never contain email text, messages or prompts.
- **Access control:** staff have no access to content, except when the customer has turned on “Lad support se med” (read-only, time-boxed and logged). Access to the server needs a personal SSH key.
- **Backups:** built but not yet switched on in beta. When they are: every night, encrypted per customer, kept for at most 30 days in the EU.
- **Policy layer:** the agent cannot pay, write to others or delete without the customer's yes.
- **Contingency:** a written plan for breaches and recovery has not been written yet. Until it is, section 9 applies.
