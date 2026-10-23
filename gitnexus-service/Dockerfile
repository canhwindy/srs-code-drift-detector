FROM node:22-trixie

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       git ca-certificates curl \
       build-essential python3 cmake \
    && rm -rf /var/lib/apt/lists/*

# Fix: allow mismatched peer deps (tree-sitter-c-sharp@0.23.5 vs tree-sitter@^0.21.1)
RUN echo "legacy-peer-deps=true" >> /root/.npmrc

# Install gitnexus CLI globally (needs python3 + build tools for tree-sitter)
# Pre-cache gitnexus via npx so analyze jobs don't download it at runtime.
# npm install -g fails on node:22-trixie due to npm 10.x arborist bug,
# so we use npx --yes which caches the package in /root/.npm/_npx/.
RUN npx --yes gitnexus --version

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./

RUN mkdir -p /data/repos

EXPOSE 4747

CMD ["node", "server.js"]
