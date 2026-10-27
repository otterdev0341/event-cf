# Frontend bundle. VITE_* values are public and baked into the JavaScript at build time.
FROM node:22-alpine AS web
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY public public
COPY src src
COPY shared shared
COPY scripts scripts
COPY supabase/migrations supabase/migrations
RUN for t in local database campaign-queue call-results scheduler recording-repair; do node "scripts/test-$t.mjs" || exit; done
ARG VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY VITE_AGENT_WEDDING_ID VITE_AGENT_CONFIRM_ID VITE_AGENT_EVENT_CONFIRM_ID
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_PUBLISHABLE_KEY" && npm run build

# API server and static file host.
FROM golang:1.26.10-alpine AS api
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend ./
RUN go vet . && go test -count=1 . && CGO_ENABLED=0 go build -trimpath -ldflags=-s -o /event-confirm .

FROM alpine:3.22
LABEL ci.project="event-confirm"
ARG BUILD_REVISION=unknown
LABEL org.opencontainers.image.revision=$BUILD_REVISION
COPY --from=api /event-confirm /app/event-confirm
COPY --from=web /src/dist /app/dist
USER 65534:65534
ENV ADDR=:8080 STATIC_DIR=/app/dist BASE_PATH=/event-confirm
EXPOSE 8080
ENTRYPOINT ["/app/event-confirm"]
