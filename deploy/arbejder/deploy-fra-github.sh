#!/usr/bin/env bash
# Forced command of the worker's SSH key in henrik's authorized_keys (KC-0047):
# the worker can deploy exactly what is merged on GitHub's main, nothing else.
set -euo pipefail
git -C ~/kontrolcenter.git fetch -q https://github.com/SlambertDK/kontrolcenter main:main
exec bash ~/kontrolcenter/deploy/deploy.sh
