# Playwright base image with Chromium and all OS dependencies pre-installed
# Using jammy (Ubuntu 22.04) for better compatibility
FROM mcr.microsoft.com/playwright:v1.58.1-jammy

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Production environment
ENV NODE_ENV=production

# Railway injects PORT env var; default to 8080
ENV PORT=8080
EXPOSE 8080

# Run the app
CMD ["npm", "start"]
