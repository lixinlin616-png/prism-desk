# Prism Desk - zero third-party dependencies, so there is no install step to fail.
# The image is the source tree plus a runtime; nothing is compiled or bundled.
FROM node:20-alpine

# auto  = try the real Bitget MCP endpoint, fall back transparently to the
#         bundled fixtures and label every snapshot with its origin.
# Set PRISM_DATA_MODE=offline for a strictly deterministic, network-free demo.
ENV PRISM_DATA_MODE=auto \
    PRISM_HOST=0.0.0.0 \
    NODE_ENV=production

WORKDIR /app
COPY . .

# data/state/ is the only path written at runtime. Own the tree as the unprivileged
# user so a read-only-rootfs deployment only needs this one directory as a volume.
RUN mkdir -p /app/data/state && chown -R node:node /app
USER node

EXPOSE 4310

# /api/status reports data wiring and ledger totals, so it doubles as a readiness
# probe: it fails if the price book or the corpus did not load.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||process.env.PRISM_PORT||4310)+'/api/status').then(function(r){process.exit(r.ok?0:1)}).catch(function(){process.exit(1)})"

CMD ["node", "server.mjs"]
