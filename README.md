# Clawco

A personal control centre that runs on your own machine. An agent shows one calm screen of what needs you. It never pays, and never messages anyone or deletes without your yes.

## Install

```bash
curl -fsSL https://clawco.work/install.sh | bash
```

What you need:

- A Mac or a Linux machine with Node 22.6 or newer, git and npm. Or Docker with the Compose plugin.
- All you need is a key from a model provider, or a model running on your own machine. Clawco comes with its own agent; there is nothing else to install.
- Optional: Tailscale, to reach Clawco from your phone.

Let your AI run it: add `--fra-ai` (`curl -fsSL https://clawco.work/install.sh | bash -s -- --fra-ai`). It asks nothing and ends with one line of JSON the AI can read: the address and what is still missing.

Advanced: use your own Hermes agent with `--agent-url URL`.

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
