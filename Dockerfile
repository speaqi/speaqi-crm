FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev --legacy-peer-deps

FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Next.js inlines NEXT_PUBLIC_* at build time — must be available here
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Copy the standalone server (includes its own node_modules)
COPY --from=builder /app/.next/standalone ./

# Copy static assets where the standalone server expects them
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "-e", "process.env.PORT='3000';process.env.HOSTNAME='0.0.0.0';require('./server.js')"]
