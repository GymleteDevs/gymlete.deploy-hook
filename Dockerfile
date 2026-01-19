FROM oven/bun:1.2.20-alpine

WORKDIR /app

RUN apk add --no-cache git docker-cli docker-compose curl
RUN git config --global --add safe.directory /repos/gymlete.deploy-hook \
  && git config --global --add safe.directory /repos/gymlete.api.hackathon

COPY deploy.ts deploy.config.json ./
COPY public ./public

EXPOSE 9061

CMD ["bun", "run", "deploy.ts"]
