FROM mcr.microsoft.com/playwright:v1.58.1-jammy

# Install Python 3.10 for yt-dlp support (Ubuntu Jammy default)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-distutils \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Install Playwright Chromium for Instagram scraping
ENV PLAYWRIGHT_BROWSERS_PATH=0
RUN npx playwright install chromium

COPY . .

# yt-dlp will auto-download to bin/ directory on first use
# The shebang will be auto-fixed to use Python 3.10+

ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm","start"]
