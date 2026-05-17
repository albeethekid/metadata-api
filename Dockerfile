FROM mcr.microsoft.com/playwright:v1.58.1-jammy

# Install Python 3.10 for yt-dlp support (Ubuntu Jammy default)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-distutils \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install curl_cffi so yt-dlp can use --impersonate to mimic real browser
# TLS/HTTP fingerprints. Without this, YouTube bot-walls our requests from
# datacenter egress (even through residential proxies).
#
# We install to an explicit location and expose it via PYTHONPATH so the
# package is visible to ANY Python invocation (root or non-root). The
# Playwright base image switches to `pwuser` at runtime — a default
# `--user` install as root wouldn't be on pwuser's sys.path.
RUN python3 -m pip install --no-cache-dir \
      --target=/opt/python-packages \
      'curl_cffi>=0.5.10,!=0.6.*,<0.8' \
 && PYTHONPATH=/opt/python-packages python3 -c \
      "import curl_cffi, sys; print('curl_cffi', curl_cffi.__version__, 'at', curl_cffi.__file__)"

ENV PYTHONPATH=/opt/python-packages

# Signal to runtime that impersonation is available so yt-dlp gets the flag.
# Use a specific Chrome target — bare 'chrome' may not match in older yt-dlp.
ENV YT_DLP_IMPERSONATE=chrome-110

WORKDIR /app

# Create bin directory for yt-dlp binary download at runtime
RUN mkdir -p /app/bin && chmod 777 /app/bin

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
