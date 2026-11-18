# The link landing page for one lane (SPEC-deeplink.md §6.5), served by landing/edge.js through scripts/serve.js.
# Build and server use Node's own modules only, so nothing is installed. Built on the dev host; see deploy/ec2/README.md.
#
#   docker build --build-arg LANE=dev --build-arg VCS_REF="$(git rev-parse HEAD)" -t zymi-links:dev .
#
# node:22.23.5-alpine3.24, multi-arch index (the dev host is arm64).
FROM node:22.23.5-alpine3.24@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a

ARG LANE=dev
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="zymi-links" \
      org.opencontainers.image.revision="${VCS_REF}"

WORKDIR /app
COPY package.json ./
COPY config config
COPY landing landing
COPY scripts/build.js scripts/serve.js scripts/
# Validates the lane's config and writes build/<lane>: a bad config fails the image build, not the deploy.
RUN node scripts/build.js --lane "${LANE}"

ENV LANDING_LANE=${LANE} \
    NODE_ENV=production
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
CMD ["node", "scripts/serve.js", "--host", "0.0.0.0", "--port", "8080"]
