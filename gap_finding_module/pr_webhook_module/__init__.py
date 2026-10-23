"""
PR Webhook Module

Reads code from GitHub pull requests and logs them to files.

Workflow:
    GitHub Webhook → FastAPI → RabbitMQ → Celery Worker
                                               ↓
                                    fetch diff + source files
                                               ↓
                                    write to ./pr_logs/<pr>.log

Integration (FastAPI app):
    from pr_webhook_module.routes import create_webhook_routes
    app.include_router(create_webhook_routes(webhook_secret="..."))

Run worker:
    python -m pr_webhook_module.workers.run_worker
"""
