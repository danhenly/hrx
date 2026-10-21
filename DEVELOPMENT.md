# Development workflow

The production build does **not** run on the dev machine. It runs in CI on GitHub's
runners, because the dev box has too little memory for `next build` (Turbopack gets
SIGKILLed by the OOM killer partway through).

## Local loop

```bash
pnpm dev          # dev server, no production build
pnpm typecheck    # tsc --noEmit — fast, low memory
pnpm exec biome lint .
```

Iterate against `pnpm dev` and `pnpm typecheck`. That is the whole local loop.

## Where the build happens

`.github/workflows/ci.yml` runs on every push and every pull request:

1. `pnpm install --frozen-lockfile`
2. `pnpm exec tsc --noEmit`
3. `pnpm exec biome lint .` (informational, does not fail the run)
4. `pnpm exec next build`

Push a branch, then read the verdict:

```bash
~/.hermes/scripts/hrx_ci.sh            # latest run for the current branch
~/.hermes/scripts/hrx_ci.sh --wait     # block until it finishes
```

Pushing to `main` additionally triggers `.github/workflows/docker-build-push.yml`,
which builds the image and publishes `ghcr.io/danhenly/hrx`.

## Do not run `pnpm build` locally

`pnpm build` is `next build && shadcn build -o 'out/r'` — it OOMs on the dev box and is
redundant, since CI already builds.

If you are forced to build locally (offline, or debugging a build-only failure), use the
reduced-memory path, which swaps Turbopack for webpack and caps the V8 heap:

```bash
pnpm build:lowmem
```
