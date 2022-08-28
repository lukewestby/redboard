FROM rust:1.63-alpine AS backend_build

WORKDIR /app
COPY . /app
RUN apk add --no-cache openssl-dev musl-dev
RUN cargo build

FROM node:16-alpine AS frontend_build

COPY . /app
WORKDIR /app
RUN yarn install
RUN yarn build

FROM alpine:3

RUN apk add --no-cache openssl-dev musl-dev libc6-compat
COPY --from=backend_build /app/target/debug/redboard /
COPY --from=frontend_build /app/static /static

EXPOSE 1234
CMD ./redboard
