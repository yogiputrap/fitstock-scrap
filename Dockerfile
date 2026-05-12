# Use the official Playwright image so Chromium + all its deps are preinstalled.
# The tag must match the playwright version in package.json.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

ENV NODE_ENV=production \
    DATA_DIR=/data \
    HTTP_PORT=3000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Install deps first for better layer caching
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# App source
COPY src ./src

# Persisted state (mount a volume here)
RUN mkdir -p /data && chown -R pwuser:pwuser /app /data
USER pwuser

EXPOSE 3000

CMD ["node", "src/index.js"]
