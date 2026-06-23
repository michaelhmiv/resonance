FROM node:18-slim

WORKDIR /app

# Copy workspace root files
COPY package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/theme/package.json ./packages/theme/
COPY packages/ui/package.json ./packages/ui/

# Install all dependencies (including workspace links)
RUN npm install --legacy-peer-deps

# Copy source
COPY . .

# Build
RUN cd apps/web && npx next build

# Expose port
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
EXPOSE 8080

# Start
CMD ["sh", "-c", "cd apps/web && npx next start -p 8080 -H 0.0.0.0"]
