# ─────────────────────────────────────────────────────────────
# Noozia API — Docker image
# Node 20 (bookworm-slim) + Chromium system libs for Puppeteer scraping
# ─────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim

# Chromium system libraries required by Puppeteer (installed Chrome)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc-s1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Puppeteer downloads Chromium into this cache dir during npm install
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# Install production dependencies (Puppeteer postinstall fetches Chromium)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Copy application source (node_modules excluded via .dockerignore)
COPY . .

# Runtime log directory
RUN mkdir -p /app/logs

ENV NODE_ENV=production \
    PUPPETEER_HEADLESS=true

EXPOSE 3000

# Default: run the API server. Override for the worker: node src/jobs/worker.js
CMD ["node", "src/index.js"]
