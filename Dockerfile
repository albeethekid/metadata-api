# Playwright base image with Chromium and all OS dependencies pre-installed
# Using jammy (Ubuntu 22.04) for better compatibility
FROM mcr.microsoft.com/playwright:v1.58.1-jammy

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Install Chromium browser matching the installed Playwright version
RUN npx playwright install --with-deps chromium

# Copy application source
COPY . .

# Production environment
ENV NODE_ENV=production

# Run the app (Railway injects PORT env var)
CMD ["npm", "start"]
