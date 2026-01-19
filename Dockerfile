FROM oven/bun:1.2.20-alpine

WORKDIR /app

RUN apk add --no-cache git docker-cli docker-compose curl

COPY deploy.ts deploy.config.json ./

EXPOSE 6061

CMD ["bun", "run", "deploy.ts"]
