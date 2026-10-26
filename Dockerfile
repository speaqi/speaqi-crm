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

# Il Chromium incluso nel pacchetto richiede NSS/NSPR anche fuori da AWS Lambda.
# Tenerle nello stage finale: le librerie del builder non arrivano nello standalone.
FROM node:20-bookworm-slim AS pdf-runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends libnspr4 libnss3 libexpat1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM pdf-runtime AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Copy the standalone server (includes its own node_modules)
COPY --from=builder /app/.next/standalone ./

# Copy static assets where the standalone server expects them
COPY --from=builder /app/.next/static ./.next/static

# Verifica browser, librerie e pacchetti tracciati nell'immagine che sarà eseguita.
# I binari decompressi della prova non vengono conservati nei layer dell'immagine.
COPY --from=builder /app/scripts/check-pdf-runtime.mjs ./scripts/check-pdf-runtime.mjs
COPY --from=builder /app/scripts/check-agency-pdf.mjs ./scripts/check-agency-pdf.mjs
RUN mkdir -p /tmp/speaqi-pdf-runtime-check \
    && TMPDIR=/tmp/speaqi-pdf-runtime-check node scripts/check-pdf-runtime.mjs \
    && rm -rf /tmp/speaqi-pdf-runtime-check

EXPOSE 3000

CMD ["node", "-e", "process.env.PORT='3000';process.env.HOSTNAME='0.0.0.0';require('./server.js')"]
