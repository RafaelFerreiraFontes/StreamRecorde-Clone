# Build stage
FROM node:25.9.0-bookworm-slim AS builder

# Install pnpm globally (builder only)
RUN npm install -g pnpm@11.20.0

WORKDIR /app

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.build.json tsconfig.json nest-cli.json ./
COPY src ./src

# Install dependencies (including dev) and build
RUN pnpm install --frozen-lockfile && pnpm build

# Prune dev dependencies in builder to produce lean production node_modules
RUN pnpm prune --prod && \
    rm -rf /root/.cache /root/.npm /root/.local && \
    npm uninstall -g pnpm

# Production stage
FROM node:25.9.0-bookworm-slim AS production

WORKDIR /app

# Copy already-pruned node_modules and built application from builder
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json

# Create config directory for runtime JSON files
RUN mkdir -p /data && chown node:node /data && chmod 2775 /data

# Switch to non-root user
USER node

# Set environment
ENV NODE_ENV=production
ENV PORT=3000
# CONFIG_DIR is the internal stack default; can be overridden at runtime
ENV CONFIG_DIR=/data

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "dist/main"]
