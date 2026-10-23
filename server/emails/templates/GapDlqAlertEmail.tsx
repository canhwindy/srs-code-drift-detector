import * as React from "react";
import type { EmailProps } from "./BaseEmail";
import BaseEmail, { EmailMessageCategory } from "./BaseEmail";
import Body from "./components/Body";
import EmailTemplate from "./components/EmailLayout";
import EmptySpace from "./components/EmptySpace";
import Footer from "./components/Footer";
import Header from "./components/Header";
import Heading from "./components/Heading";

type Props = EmailProps & {
  prId: number;
  repo: string;
  prTitle: string;
  error: string;
  failedAt: string;
  retryCount: number;
};

/**
 * Alert email sent when a gap-finding result message fails to save to DB
 * after all retries and is routed to the dead letter queue.
 */
export default class GapDlqAlertEmail extends BaseEmail<Props> {
  protected get category() {
    return EmailMessageCategory.Internal;
  }

  protected subject({ prId, repo }: Props) {
    return `[DLQ Alert] Gap result for PR #${prId} — ${repo} failed after all retries`;
  }

  protected preview({ prId, repo }: Props) {
    return `Gap result for PR #${prId} (${repo}) could not be saved to DB`;
  }

  protected renderAsText({ prId, repo, prTitle, error, failedAt, retryCount }: Props): string {
    return `
Gap result message failed to save to DB after all retries and was moved to Dead Letter Queue.

PR INFO
-------
PR Number  : #${prId}
Title      : ${prTitle}
Repository : ${repo}

FAILURE INFO
------------
Failed At  : ${failedAt}
Retry Count: ${retryCount}
Error      : ${error}

ACTION
------
Check RabbitMQ Management UI to inspect and reprocess:
http://localhost:15672 → Queues → gap_results.dlq
`.trim();
  }

  protected render(props: Props) {
    const { prId, repo, prTitle, error, failedAt, retryCount } = props;

    return (
      <EmailTemplate previewText={this.preview(props)}>
        <Header />

        <Body>
          <Heading>Gap Result DLQ Alert</Heading>
          <p>
            A gap-finding result message failed to save to the database after{" "}
            {retryCount} retries and was moved to the Dead Letter Queue.
          </p>
          <EmptySpace height={10} />
          <p>
            <strong>PR:</strong> #{prId} — {prTitle}
            <br />
            <strong>Repository:</strong> {repo}
          </p>
          <EmptySpace height={10} />
          <p>
            <strong>Error:</strong> {error}
            <br />
            <strong>Failed at:</strong> {failedAt}
            <br />
            <strong>Retries:</strong> {retryCount}
          </p>
          <EmptySpace height={10} />
          <p>
            Check{" "}
            <a href="http://localhost:15672">RabbitMQ Management UI</a>{" "}
            → Queues → <code>gap_results.dlq</code> to inspect and reprocess.
          </p>
        </Body>

        <Footer />
      </EmailTemplate>
    );
  }
}
