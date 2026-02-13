FROM mcr.microsoft.com/playwright:v1.58.1-jammy

# Install Python 3.11 for yt-dlp support
RUN apt-get update && apt-get install -y \
    software-properties-common \
    && add-apt-repository ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y \
    python3.11 \
    python3.11-distutils \
    && rm -rf /var/lib/apt/lists/*

# Create symlink for python3.11 to be available as python3.11
RUN update-alternatives --install /usr/bin/python3.11 python3.11 /usr/bin/python3.11 1

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Install Playwright Chromium for Instagram scraping
ENV PLAYWRIGHT_BROWSERS_PATH=0
RUN npx playwright install chromium

COPY . .

# yt-dlp will auto-download to bin/ directory on first use
# The shebang will be auto-fixed to use Python 3.11

ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm","start"]
