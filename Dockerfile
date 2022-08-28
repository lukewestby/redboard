FROM rust:1.63-bullseye AS backend_build

WORKDIR /app
COPY . /app
RUN cargo build

FROM node:16-alpine AS frontend_build

COPY . /app
WORKDIR /app
RUN yarn install
RUN yarn build

FROM debian:bullseye-slim

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && apt-get autoremove -y \
    && apt-get clean -y \
    && rm -rf /var/lib/apt/lists/*WORKDIR

COPY --from=backend_build /app/target/debug/redboard /
COPY --from=frontend_build /app/static /static

CMD ./redboard
