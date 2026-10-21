FROM rust:1.97.0-bookworm AS build
WORKDIR /build
ENV CARGO_BUILD_JOBS=1
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release --locked
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* && useradd --uid 10001 --create-home app
COPY --from=build /build/target/release/event-confirm-api /usr/local/bin/event-confirm-api
USER 10001
ENV BIND_ADDRESS=0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["event-confirm-api"]
