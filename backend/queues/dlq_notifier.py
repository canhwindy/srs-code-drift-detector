"""
DLQ Alert Notifier — gửi email khi message bị route sang Dead Letter Queue.

Dùng Python stdlib smtplib (không cần thêm dependency).
Chạy trong asyncio.to_thread để không block event loop.

Env vars (đọc từ .env.local / docker-compose):
    SMTP_SERVICE      : "gmail" (hiện chỉ hỗ trợ gmail)
    SMTP_USERNAME     : địa chỉ gửi
    SMTP_PASSWORD     : app password
    SMTP_FROM_EMAIL   : display from address (mặc định = SMTP_USERNAME)
    DLQ_ALERT_EMAIL   : địa chỉ nhận alert
"""

import asyncio
import logging
import os
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)

_GMAIL_HOST = "smtp.gmail.com"
_GMAIL_PORT = 587


def _send_dlq_alert_sync(
    pr_id: int,
    repo: str,
    pr_title: str,
    error: str,
    failed_at: str,
    retry_count: int,
) -> None:
    """Synchronous SMTP send — gọi qua asyncio.to_thread."""
    to_addr = os.getenv("DLQ_ALERT_EMAIL", "")
    username = os.getenv("SMTP_USERNAME", "")
    password = os.getenv("SMTP_PASSWORD", "")
    from_addr = os.getenv("SMTP_FROM_EMAIL", username)

    if not to_addr or not username or not password:
        logger.warning(
            "[DLQNotifier] Email not sent — missing SMTP_USERNAME / SMTP_PASSWORD / DLQ_ALERT_EMAIL"
        )
        return

    subject = f"[DLQ Alert] Gap finding for PR #{pr_id} — {repo} failed after all retries"

    text_body = f"""
Gap finding message failed to process after all retries and was moved to Dead Letter Queue.

PR INFO
-------
PR Number  : #{pr_id}
Title      : {pr_title}
Repository : {repo}

FAILURE INFO
------------
Failed At  : {failed_at}
Retry Count: {retry_count}
Error      : {error}

ACTION
------
Check RabbitMQ Management UI to inspect and reprocess:
http://localhost:15672 → Queues → pr_events.dlq
""".strip()

    html_body = f"""
<html><body style="font-family: sans-serif; color: #333;">
  <h2 style="color: #c0392b;">&#9888; Gap Finding DLQ Alert</h2>
  <p>A PR event message failed to process after <strong>{retry_count}</strong> retries
     and was moved to the Dead Letter Queue.</p>

  <table style="border-collapse: collapse; margin: 16px 0;">
    <tr><th style="text-align:left;padding:4px 12px 4px 0">PR</th>
        <td>#{pr_id} — {pr_title}</td></tr>
    <tr><th style="text-align:left;padding:4px 12px 4px 0">Repository</th>
        <td>{repo}</td></tr>
    <tr><th style="text-align:left;padding:4px 12px 4px 0">Failed at</th>
        <td>{failed_at}</td></tr>
    <tr><th style="text-align:left;padding:4px 12px 4px 0">Error</th>
        <td style="color:#c0392b">{error}</td></tr>
  </table>

  <p>Check <a href="http://localhost:15672">RabbitMQ Management UI</a>
     → Queues → <code>pr_events.dlq</code> to inspect and reprocess.</p>
</body></html>
""".strip()

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(_GMAIL_HOST, _GMAIL_PORT) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.login(username, password)
        smtp.sendmail(from_addr, [to_addr], msg.as_string())

    logger.info("[DLQNotifier] Alert sent to %s for PR #%s", to_addr, pr_id)


async def send_dlq_alert(
    pr_id: int,
    repo: str,
    pr_title: str,
    error: str,
    retry_count: int,
) -> None:
    """
    Async wrapper — gửi DLQ alert email mà không block event loop.
    Lỗi email được log warning, không raise (không làm gián đoạn DLQ flow).
    """
    failed_at = datetime.now(timezone.utc).isoformat()
    try:
        await asyncio.to_thread(
            _send_dlq_alert_sync,
            pr_id=pr_id,
            repo=repo,
            pr_title=pr_title,
            error=error,
            failed_at=failed_at,
            retry_count=retry_count,
        )
    except Exception as exc:
        logger.warning("[DLQNotifier] Failed to send alert email: %s", exc)
