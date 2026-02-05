# Playwright base image with Chromium pre-installed (matches package.json version)
FROM mcr.microsoft.com/playwright:v1.58.1-noble

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install production dependencies only (skip postinstall browser download since base image has them)
RUN npm ci --omit=dev --ignore-scripts

# Copy application source
COPY . .

# Railway injects PORT env var; default to 3000
ENV PORT=3000
EXPOSE 3000

# Run the app
CMD ["npm", "start"]
