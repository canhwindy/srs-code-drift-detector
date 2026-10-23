FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y curl git ca-certificates supervisor \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22.x + Claude CLI
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g @anthropic-ai/claude-code \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- pr_webhook_module (Python) ---
COPY pr_webhook_module/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY pr_webhook_module/ ./pr_webhook_module/

# Supervisord config
COPY supervisord.conf /etc/supervisor/conf.d/gapfinding.conf

RUN mkdir -p /app/pr_logs /data/repos

EXPOSE 8011

CMD ["supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
