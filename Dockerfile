# Use the official Playwright image so system deps (fonts, libs) are preinstalled.
# The scraper uses Playwright; whatsapp-web.js uses Puppeteer-managed Chrome
# which will be downloaded into the app cache dir at install time.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

ENV NODE_ENV=production \
    DATA_DIR=/data \
    HTTP_PORT=3000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    # Skip puppeteer's own Chrome download — we reuse the Chromium
    # that is already bundled in this image.
    PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src

RUN mkdir -p /data && chown -R pwuser:pwuser /app /data
USER pwuser

EXPOSE 3000

CMD ["node", "src/index.js"]
