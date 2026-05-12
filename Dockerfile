# Use the official Playwright image so system deps (fonts, libs) are preinstalled.
# The scraper uses Playwright; whatsapp-web.js uses Puppeteer-managed Chrome
# which will be downloaded into the app cache dir at install time.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

ENV NODE_ENV=production \
    DATA_DIR=/data \
    HTTP_PORT=3000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

WORKDIR /app

# Install deps first for better layer caching. Puppeteer's postinstall will
# download Chrome to PUPPETEER_CACHE_DIR (/app/.cache/puppeteer).
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# App source
COPY src ./src

# Persisted state (mount a volume here)
RUN mkdir -p /data && chown -R pwuser:pwuser /app /data
USER pwuser

EXPOSE 3000

CMD ["node", "src/index.js"]
