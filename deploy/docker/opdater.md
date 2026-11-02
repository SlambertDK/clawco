# Updating Clawco in Docker (KC-0158)

```bash
docker compose pull && docker compose up -d
```

`pull` fetches the newest image, `up -d` replaces the running container with it. Your user
folder is the named volume `clawco-data` (mounted at `/data`); a new image never carries data
and compose never removes the volume, so notes, rules, settings and `/data/.env` are as they
were. Never add `-v` to `docker compose down`: that flag deletes the volume.

If you build the image yourself from a clone of the code, update the clone first, then
`GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build` (the sha makes `/health`
say which version runs).

Check which version runs:

```bash
curl -fsS http://127.0.0.1:8750/health   # "sha" is the running version
```

There is no automatic roll back here: if the new container does not start, run
`docker compose logs --tail 20 clawco`, and start the previous image again by name
(`docker image ls` lists it). For a copy to keep before you update, see the backup note in
`deploy/docker/README.md`.
