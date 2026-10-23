"""
DLQ Consumer — đọc message từ pr_webhook.dlq và gửi email alert.

Usage:
    python -m pr_webhook_module.workers.dlq_consumer

Environment Variables:
    CELERY_BROKER_URL: RabbitMQ connection URL
    SMTP_SERVICE: Well-known SMTP service (e.g., gmail)
    SMTP_HOST: SMTP server hostname (dùng nếu không có SMTP_SERVICE)
    SMTP_PORT: SMTP server port (default: 587)
    SMTP_USERNAME: SMTP auth username
    SMTP_PASSWORD: SMTP auth password
    SMTP_FROM_EMAIL: Sender email address
    DLQ_ALERT_EMAIL: Email nhận alert (default: SMTP_FROM_EMAIL)
"""

import json
import logging
import os
import smtplib
import socket
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from dotenv import load_dotenv
from kombu import Connection, Exchange, Queue

load_dotenv(dotenv_path=".env", override=False)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# SMTP_SERVICE → (host, port)
_SMTP_SERVICE_MAP = {
    "gmail": ("smtp.gmail.com", 587),
    "outlook": ("smtp.office365.com", 587),
    "yahoo": ("smtp.mail.yahoo.com", 587),
    "sendgrid": ("smtp.sendgrid.net", 587),
}


def _get_smtp_config() -> tuple[str, int, str, str, str]:
    service = os.getenv("SMTP_SERVICE", "").lower()
    if service and service in _SMTP_SERVICE_MAP:
        host, port = _SMTP_SERVICE_MAP[service]
    else:
        host = os.getenv("SMTP_HOST", "")
        port = int(os.getenv("SMTP_PORT", "587"))

    username = os.getenv("SMTP_USERNAME", "")
    password = os.getenv("SMTP_PASSWORD", "")
    from_email = os.getenv("SMTP_FROM_EMAIL", username)
    return host, port, username, password, from_email


def _build_email_body(message: dict) -> tuple[str, str]:
    """
    Build (subject, body) for a DLQ alert email.
    Handles three message types: pr_webhook, config_event, team_event.
    """
    error = message.get("error", "N/A")
    failed_at = message.get("failed_at", "N/A")
    retry_count = message.get("retry_count", "N/A")

    # Support both key names used by different producers
    original = message.get("original_payload") or message.get("original", {})
    if not isinstance(original, dict):
        original = {}

    failure_block = f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FAILURE INFO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Failed At  : {failed_at}
Retry Count: {retry_count}
Error      : {error}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Open RabbitMQ Management UI to inspect and reprocess:
http://localhost:15672 → Queues""".strip()

    # PR webhook message
    pr_data = original.get("pull_request", {})
    if pr_data:
        repo_data = original.get("repository", {})
        pr_number = pr_data.get("number", "N/A")
        pr_title = pr_data.get("title", "N/A")
        repo_name = repo_data.get("full_name", "N/A")
        pr_url = pr_data.get("html_url", "N/A")
        subject = f"[DLQ Alert] PR #{pr_number} — {repo_name} failed after all retries"
        body = f"""
PR webhook processing failed after all retries and was moved to Dead Letter Queue.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PR INFO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PR Number  : #{pr_number}
Title      : {pr_title}
Repository : {repo_name}
URL        : {pr_url}
Task ID    : {message.get("task_id", "N/A")}

{failure_block}""".strip()
        return subject, body

    # Config event message
    event = original.get("event", "")
    team_id = original.get("teamId", "N/A")
    if event.startswith("config."):
        subject = f"[DLQ Alert] Config sync failed — team {team_id}"
        body = f"""
GitHub config sync event failed after all retries and was moved to Dead Letter Queue.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EVENT INFO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Event   : {event}
Team ID : {team_id}

{failure_block}""".strip()
        return subject, body

    # Team lifecycle event message
    if event.startswith("team."):
        subject = f"[DLQ Alert] Team event failed — {event} for team {team_id}"
        body = f"""
Team lifecycle event failed after all retries and was moved to Dead Letter Queue.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EVENT INFO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Event   : {event}
Team ID : {team_id}

{failure_block}""".strip()
        return subject, body

    # Unknown — generic fallback
    subject = "[DLQ Alert] Unknown message failed after all retries"
    body = f"Raw message:\n{json.dumps(message, indent=2)}\n\n{failure_block}"
    return subject, body


def _send_alert_email(message: dict) -> None:
    host, port, username, password, from_email = _get_smtp_config()
    to_email = os.getenv("DLQ_ALERT_EMAIL", from_email)

    subject, body = _build_email_body(message)

    msg = MIMEMultipart()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))

    with smtplib.SMTP(host, port) as server:
        server.ehlo()
        server.starttls()
        server.login(username, password)
        server.sendmail(from_email, to_email, msg.as_string())

    logger.info(f"Alert email sent to {to_email} for task {message.get('task_id')}")


def _process_message(body, message) -> None:
    try:
        if isinstance(body, (bytes, bytearray)):
            body = json.loads(body.decode())
        elif isinstance(body, str):
            body = json.loads(body)
        logger.info(f"DLQ message received — task_id: {body.get('task_id')}, error: {body.get('error')}")
        _send_alert_email(body)
        message.ack()
    except Exception as e:
        logger.error(f"Failed to process DLQ message: {e}")
        message.reject(requeue=False)


def run() -> None:
    broker_url = os.getenv("CELERY_BROKER_URL", "amqp://guest:guest@localhost:5672//")
    queues = [
        Queue(
            "pr_webhook.dlq",
            Exchange("pr_webhook.dlx", type="direct", durable=True),
            routing_key="pr_webhook.dead",
            durable=True,
        ),
        Queue(
            "github_config_events.dlq",
            Exchange("github_config_events.dlx", type="direct", durable=True),
            routing_key="github_config_events.dlq",
            durable=True,
        ),
        Queue(
            "team_events.dlq",
            Exchange("team_events.dlx", type="direct", durable=True),
            routing_key="team_events.dlq",
            durable=True,
        ),
    ]

    logger.info("DLQ consumer started, waiting for messages...")
    while True:
        try:
            with Connection(broker_url) as conn:
                with conn.Consumer(queues, callbacks=[_process_message], accept=["json"]):
                    while True:
                        try:
                            conn.drain_events(timeout=5)
                        except socket.timeout:
                            pass  # no messages, keep waiting
        except socket.timeout:
            pass
        except Exception as e:
            logger.error(f"DLQ consumer connection error: {e}. Reconnecting in 5s...")
            time.sleep(5)


if __name__ == "__main__":
    run()
