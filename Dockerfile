# Playwright base image with Chromium and all OS dependencies pre-installed
# Using jammy (Ubuntu 22.04) for better compatibility
FROM mcr.microsoft.com/playwright:v1.58.1-jammy

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install production dependencies only
# --ignore-scripts skips postinstall since base image already has browsers
RUN npm ci --omit=dev --ignore-scripts

# Copy application source
COPY . .

# Production environment
ENV NODE_ENV=production

# Railway injects PORT env var; default to 3000
ENV PORT=3000
EXPOSE 3000

# Run the app
CMD ["npm", "start"]
