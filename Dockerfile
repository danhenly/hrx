FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
# deps layer cached unless lockfile changes
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . ./
RUN pnpm exec next build
CMD ["pnpm", "start"]