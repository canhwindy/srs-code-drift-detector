import * as React from "react";
import { useHistory } from "react-router-dom";
import styled from "styled-components";
import { s } from "@shared/styles";
import env from "~/env";

/**
 * Regular expression to match URLs in text.
 * Matches http, https, and www URLs.
 */
const URL_REGEX = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s]|www\.[^\s<]+[^<.,:;"')\]\s])/gi;

/**
 * Regular expression to match @mentions in text.
 * Matches @name followed by optional ZWSP (Zero-Width Space) marker.
 * ZWSP is used to mark the end of a mention inserted via autocomplete.
 */
const MENTION_REGEX = /@([\w\u00C0-\u024F\u1E00-\u1EFF]+(?:\s+[\w\u00C0-\u024F\u1E00-\u1EFF]+)?)\u200B?/g;

interface LinkifyProps {
  /** The text content to parse for links and mentions. */
  children: string;
  /** Whether to highlight @mentions. */
  highlightMentions?: boolean;
  /** Additional className for styling. */
  className?: string;
}

/**
 * Checks if a URL is an internal Outline link.
 *
 * @param url - the URL to check.
 * @returns true if the URL is internal to the Outline app.
 */
function isInternalLink(url: string): boolean {
  try {
    const linkUrl = new URL(url);
    const appUrl = new URL(env.URL);
    return linkUrl.hostname === appUrl.hostname;
  } catch {
    return false;
  }
}

/**
 * Extracts the path from an internal URL.
 *
 * @param url - the full URL.
 * @returns the pathname for internal navigation.
 */
function getInternalPath(url: string): string {
  try {
    const linkUrl = new URL(url);
    return linkUrl.pathname + linkUrl.search + linkUrl.hash;
  } catch {
    return url;
  }
}

/**
 * Parses text and converts URLs to clickable links and optionally highlights @mentions.
 *
 * @param props - the component props.
 * @returns the parsed content with clickable links.
 */
function Linkify({ children, highlightMentions = true, className }: LinkifyProps) {
  const history = useHistory();

  const handleInternalLinkClick = React.useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
      e.preventDefault();
      e.stopPropagation();
      history.push(path);
    },
    [history]
  );

  const content = React.useMemo(() => {
    if (!children || typeof children !== "string") {
      return children;
    }

    const parts: (string | React.ReactElement)[] = [];
    let lastIndex = 0;
    let keyIndex = 0;

    // Combined regex for URLs and mentions
    const combinedRegex = highlightMentions
      ? new RegExp(`(${URL_REGEX.source})|(${MENTION_REGEX.source})`, "gi")
      : URL_REGEX;

    let match;
    while ((match = combinedRegex.exec(children)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        parts.push(children.slice(lastIndex, match.index));
      }

      const matchedText = match[0];

      // Check if it's a URL
      if (matchedText.match(/^(https?:\/\/|www\.)/i)) {
        const href = matchedText.startsWith("www.")
          ? `https://${matchedText}`
          : matchedText;

        const isInternal = isInternalLink(href);

        if (isInternal) {
          const internalPath = getInternalPath(href);
          parts.push(
            <StyledLink
              key={`link-${keyIndex++}`}
              href={href}
              onClick={(e) => handleInternalLinkClick(e, internalPath)}
            >
              {matchedText}
            </StyledLink>
          );
        } else {
          parts.push(
            <StyledLink
              key={`link-${keyIndex++}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              {matchedText}
            </StyledLink>
          );
        }
      }
      // Check if it's a mention
      else if (matchedText.startsWith("@")) {
        parts.push(
          <MentionHighlight key={`mention-${keyIndex++}`}>
            {matchedText}
          </MentionHighlight>
        );
      }

      lastIndex = match.index + matchedText.length;
    }

    // Add remaining text
    if (lastIndex < children.length) {
      parts.push(children.slice(lastIndex));
    }

    return parts.length > 0 ? parts : children;
  }, [children, highlightMentions, handleInternalLinkClick]);

  return <span className={className}>{content}</span>;
}

const StyledLink = styled.a`
  color: ${s("accent")};
  text-decoration: none;
  word-break: break-all;

  &:hover {
    text-decoration: underline;
  }
`;

const MentionHighlight = styled.span`
  background-color: ${s("accent")}20;
  color: ${s("accent")};
  padding: 1px 4px;
  border-radius: 4px;
  font-weight: 500;
`;

export default Linkify;
