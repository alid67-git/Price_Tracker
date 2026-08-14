FROM mcr.microsoft.com/playwright:v1.48.2-jammy

WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY config ./config
COPY dashboard ./dashboard

EXPOSE 3456
CMD ["node", "src/server.js"]
