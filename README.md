# Clawco

A personal control centre that runs on your own machine. An agent shows one calm screen of what needs you. It never pays, and never messages anyone or deletes without your yes.

## Install

```bash
curl -fsSL https://clawco.work/install.sh | bash
```

What you need:

- A Mac or a Linux machine with Node 22.6 or newer, git and npm. Or Docker with the Compose plugin.
- A key from a model provider, or a model running on your own machine.
- Optional: Tailscale, to reach Clawco from your phone.

Guides: https://clawco.work/docs/

## Develop

```bash
npm ci
npm run dev        # http://127.0.0.1:8750 with a scripted agent and fake sources
npm run typecheck
npm test
```

## Licence

AGPL-3.0, see [LICENSE](LICENSE).

This repository is a one-way mirror of the code. Tickets and design notes live in the maintainer's private record.
