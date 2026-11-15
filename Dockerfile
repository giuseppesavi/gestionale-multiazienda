# Immagine del gestionale: Node.js 22, solo le dipendenze di produzione, utente non amministratore.
FROM node:22-alpine
ENV NODE_ENV=production TZ=Europe/Rome
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY app ./app
COPY server ./server
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server/index.js"]
