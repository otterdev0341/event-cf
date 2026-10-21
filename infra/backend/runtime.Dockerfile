FROM debian:bookworm-slim
LABEL ci.project="event-confirm"
ARG BUILD_REVISION=unknown
LABEL org.opencontainers.image.revision=$BUILD_REVISION
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* && useradd --uid 10001 --create-home app
COPY backend/target/release/event-confirm-api /usr/local/bin/event-confirm-api
USER 10001
ENV BIND_ADDRESS=0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["event-confirm-api"]
