# Clawco in your own cloud (KC-0171)

For a person without a box at home: the same Docker install as `deploy/docker/` (KC-0157), on a small
server in a cloud account **you** own, reachable only over **your** Tailscale net. Bring-your-own-cloud:
Clawco does not host anything for anyone, never sees your token, your key or your data, and the only
Clawco-owned address involved is the static site that serves this script.

First provider: Hetzner Cloud (`hetzner.sh`; EU locations Falkenstein, Nuremberg, Helsinki). Fly.io is the
follow-up (its own ticket); it will get a recipe next to this one, with the same invariants below.

```bash
export HCLOUD_TOKEN=...                       # a read/write API token for one Hetzner project
bash deploy/egen-sky/hetzner.sh --dry-run --authkey-fil ~/tskey   # look first: plan, firewall, cloud-init, nothing sent
bash deploy/egen-sky/hetzner.sh --navn clawco --authkey-fil ~/tskey
```

Needs `curl` and bash (macOS 3.2 is fine). No `jq`, no Terraform. The script's messages are Danish, like
`install.sh`; `--help` lists every option.

## What it does

1. Creates a Hetzner firewall `clawco-<navn>` with **no inbound rule**. Hetzner firewalls are allow-lists, so
   no rule means all inbound traffic is dropped; outbound stays open (Tailscale and GitHub need it).
2. Creates a server `clawco-<navn>` (Ubuntu 24.04, default `cx22`, default location `fsn1`) with that
   firewall attached and the generated cloud-init as `user_data`. It polls until Hetzner reports `running`,
   then prints the tailnet address and the exact `/health` check to run from a device on your tailnet.
3. The cloud-init, on first boot: installs Docker, Compose and ufw (`default deny incoming`, outbound open,
   only `41641/udp` for direct Tailscale connections); turns on unattended OS upgrades; clones the public
   mirror (`https://github.com/SlambertDK/clawco.git`); and runs
   `docker compose --profile tailscale up -d --build` with `CLAWCO_TS_NAVN=<navn>`. The Tailscale
   container joins your tailnet and serves Clawco over HTTPS on 443; Funnel stays off, and compose still
   publishes `127.0.0.1` only (`test/docker-files.test.ts`). Three locks, each enough on its own: the cloud
   firewall, ufw, and loopback-only publishing.
4. The auth key goes into the cloud-init only, is written mode 600 to the compose secret file, and is
   `shred -u`'d as soon as the node has an address on your tailnet (the file is then recreated empty, so
   the compose bind mount still resolves after a reboot). `TS_AUTH_ONCE` and the state volume keep the
   node logged in.

`--dry-run` prints the plan with the monthly cost, the firewall JSON and the cloud-init with the key masked, and
makes no call. It needs no token.

## What it never does

- **No public port.** Nothing is open inbound at the cloud firewall or on the host.
- **No SSH.** There is no SSH server rule and no key is installed. The server is replaced, not repaired.
- **No Clawco host receives anything.** The script talks to `api.hetzner.cloud` (your account) and, from the
  VM, to `github.com`. `test/egen-sky.test.ts` holds that list.
- **Never stores your token or key.** `HCLOUD_TOKEN` is read from the environment only; it is handed to curl as a
  config on a file descriptor (never on a command line or on disk). The key is read from a file or hidden
  from the terminal and is never printed (not even in `--dry-run`).
- **Never touches other resources.** If creating the server fails after the firewall was created, it deletes
  that firewall again and nothing else.

## Before you run it

- A Hetzner Cloud project and a read/write API token (Security, API tokens).
- A Tailscale account (free) with **HTTPS enabled** under DNS in the admin console (Serve needs
  certificates), and a **single-use, non-reusable, short-expiry** auth key (Settings, Keys, Generate auth
  key). Save it in a file and pass `--authkey-fil`; the key is useless once the node has joined.
- Cost: about 4–5 euro a month for the smallest server, paid to Hetzner. Clawco and a personal Tailscale
  account are free. The script's cost table only knows the sizes it was written against; other types print a
  pointer to Hetzner's console.

## Destroy, update, back up

- **Destroy:** delete the server and the firewall `clawco-<navn>` in the Hetzner console (or `hcloud server
  delete` / `hcloud firewall delete` with your own CLI). Billing stops with the server. Remove the machine
  from your Tailscale admin page as well. Your data was on that server's disk and is gone with it.
- **Update:** re-create. Take a copy of the data first if you want to keep it
  (`deploy/docker/README.md` shows the volume copy; there is no SSH, so do it before you delete, or
  accept a fresh start), then delete the server and run the script again; `--sha <commit>` pins the exact
  version, `--ref <branch-or-tag>` follows a branch. A `docker compose pull` style update in place is not
  offered on purpose: nothing can log in to do it.
- **Backups of the VM** are out of scope here; KC-0159 covers the user folder.

## Tests

`test/egen-sky.test.ts`: `bash -n`; `--dry-run` asserts an empty firewall rule list, `ufw default deny incoming`,
no `allow 22/80/443`, no `0.0.0.0:8750`, the `--profile tailscale` start, the masked key and the
shred order; the apply path runs against a fake `curl` (token and key never in argv, only
`api.hetzner.cloud`, a 401 and a quota error end in one Danish sentence). A real VM in a throwaway Hetzner
account is the manual proof (ticket KC-0171, §5): Start reached over the tailnet from a phone, then the VM
destroyed.
