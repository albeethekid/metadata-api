FROM mcr.microsoft.com/playwright:v1.58.1-jammy

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

ENV PLAYWRIGHT_BROWSERS_PATH=0
RUN npx playwright install chromium

COPY . .
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm","start"]
