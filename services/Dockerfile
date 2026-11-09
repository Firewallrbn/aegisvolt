# Una imagen por servicio: docker build --build-arg SERVICE=billing-wallet -t billing-wallet services/
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY common ./common
ARG SERVICE
COPY ${SERVICE} ./${SERVICE}
ENV SERVICE=${SERVICE} NODE_ENV=production
USER node
EXPOSE 4000-4003
CMD ["sh", "-c", "exec node \"$SERVICE/index.ts\""]
