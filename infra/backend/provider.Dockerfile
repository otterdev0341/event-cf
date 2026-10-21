FROM node:22-bookworm-slim
LABEL ci.project="event-confirm"
ARG BUILD_REVISION=unknown
LABEL org.opencontainers.image.revision=$BUILD_REVISION
RUN mkdir /data && chown node:node /data
COPY scripts/ops/simulated-provider.mjs /app.mjs
USER node
EXPOSE 8080
CMD ["node", "/app.mjs"]
