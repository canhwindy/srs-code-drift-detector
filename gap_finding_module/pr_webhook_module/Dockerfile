FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy module source vào đúng package path
COPY . ./pr_webhook_module/

# Default: run FastAPI webhook service
# Celery worker overrides this via docker-compose command:
CMD ["uvicorn", "pr_webhook_module.app:app", "--host", "0.0.0.0", "--port", "8011"]
