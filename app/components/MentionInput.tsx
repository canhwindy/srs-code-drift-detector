import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { s } from "@shared/styles";
import useStores from "~/hooks/useStores";

interface User {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}

/**
 * A textarea input component with @mention autocomplete functionality.
 *
 * @param props - The component props.
 * @returns the mention input component.
 */
function MentionInput({
  value,
  onChange,
  placeholder,
  rows = 2,
  disabled = false,
  onPaste,
}: MentionInputProps) {
  const { t } = useTranslation();
  const { kanbanBoards } = useStores();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const mirrorRef = React.useRef<HTMLDivElement>(null);
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null);
  const [mentionPosition, setMentionPosition] = React.useState({ top: 0, left: 0 });
  const [suggestions, setSuggestions] = React.useState<User[]>([]);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [cursorPosition, setCursorPosition] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(false);
  const [atStartIndex, setAtStartIndex] = React.useState(-1);

  /**
   * Searches for mentionable users.
   *
   * @param query - the search query.
   */
  const searchUsers = React.useCallback(async (query: string) => {
    setIsLoading(true);
    try {
      const results = await kanbanBoards.searchMentionableUsers(query);
      setSuggestions(results);
      setSelectedIndex(0);
    } catch (_error) {
      toast.error(t("Failed to search users"));
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, [kanbanBoards]);

  /**
   * Updates the popup position based on the @ character position.
   */
  const updatePopupPosition = React.useCallback((textarea: HTMLTextAreaElement, atPosition: number) => {
    if (!mirrorRef.current || !containerRef.current) {
      return;
    }

    const mirror = mirrorRef.current;
    const textBeforeAt = value.substring(0, atPosition);

    // Set mirror content to match text up to @
    mirror.textContent = textBeforeAt;

    // Add a span to mark the @ position
    const marker = document.createElement("span");
    marker.textContent = "@";
    marker.style.position = "relative";
    mirror.appendChild(marker);

    const containerRect = containerRef.current.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();

    // Calculate position relative to container
    const top = markerRect.bottom - containerRect.top + 4;
    const left = markerRect.left - containerRect.left;

    setMentionPosition({
      top: Math.min(top, textarea.offsetHeight + 4),
      left: Math.max(0, left),
    });

    // Clean up marker
    mirror.textContent = textBeforeAt;
  }, [value]);

  /**
   * Handles input change and detects @mention.
   *
   * @param e - the change event.
   */
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const position = e.target.selectionStart || 0;

    onChange(newValue);
    setCursorPosition(position);

    // Find @ symbol before cursor
    const textBeforeCursor = newValue.substring(0, position);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      // Check if there's a space or newline after @ (which would end the mention)
      if (!textAfterAt.includes(" ") && !textAfterAt.includes("\n")) {
        setMentionQuery(textAfterAt);
        setAtStartIndex(lastAtIndex);
        searchUsers(textAfterAt);

        // Update position after state update
        setTimeout(() => {
          if (textareaRef.current) {
            updatePopupPosition(textareaRef.current, lastAtIndex);
          }
        }, 0);
        return;
      }
    }

    setMentionQuery(null);
    setAtStartIndex(-1);
    setSuggestions([]);
  };

  // Zero-Width Space character to mark the end of a mention
  const ZWSP = "\u200B";

  /**
   * Handles inserting a mention.
   *
   * @param user - the user to mention.
   */
  const insertMention = (user: User) => {
    if (!textareaRef.current || atStartIndex === -1) {
      return;
    }

    const textarea = textareaRef.current;
    const beforeAt = value.substring(0, atStartIndex);
    const afterCursor = value.substring(cursorPosition);

    // Always add ZWSP after mention name to mark end of mention, then a space
    // This prevents following text from being included in mention formatting
    // Trim leading space/ZWSP from afterCursor to avoid double spaces
    const trimmedAfterCursor = afterCursor.replace(/^[\s\u200B]+/, "");
    const newValue = `${beforeAt}@${user.name}${ZWSP} ${trimmedAfterCursor}`;

    onChange(newValue);

    // Set cursor after the inserted mention, ZWSP, and space (@ = 1, name.length, ZWSP = 1, space = 1)
    const newCursorPosition = atStartIndex + user.name.length + 3;
    setTimeout(() => {
      textarea.selectionStart = newCursorPosition;
      textarea.selectionEnd = newCursorPosition;
      textarea.focus();
    }, 0);

    setMentionQuery(null);
    setAtStartIndex(-1);
    setSuggestions([]);
  };

  /**
   * Handles keyboard navigation in suggestions.
   *
   * @param e - the keyboard event.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery === null || suggestions.length === 0) {
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        break;
      case "Enter":
        if (suggestions[selectedIndex]) {
          e.preventDefault();
          insertMention(suggestions[selectedIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setMentionQuery(null);
        setAtStartIndex(-1);
        setSuggestions([]);
        break;
      case "Tab":
        if (suggestions[selectedIndex]) {
          e.preventDefault();
          insertMention(suggestions[selectedIndex]);
        }
        break;
    }
  };

  /**
   * Handles blur event.
   */
  const handleBlur = () => {
    // Delay hiding to allow click on suggestion
    setTimeout(() => {
      setMentionQuery(null);
      setAtStartIndex(-1);
      setSuggestions([]);
    }, 200);
  };

  /**
   * Renders the text with highlighted mentions.
   * Mentions are marked with a Zero-Width Space (ZWSP) at the end to separate them from following text.
   */
  const renderHighlightedText = () => {
    // Match @username patterns that end with ZWSP (inserted mentions)
    // This ensures only properly inserted mentions are highlighted, not partial typing
    const mentionRegex = /(@[^\u200B]+)\u200B/g;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    let keyIndex = 0;

    while ((match = mentionRegex.exec(value)) !== null) {
      // Add text before the mention
      if (match.index > lastIndex) {
        parts.push(<span key={keyIndex++}>{value.slice(lastIndex, match.index)}</span>);
      }

      // Add the highlighted mention (the ZWSP is invisible so we don't need to render it separately)
      parts.push(<MentionHighlight key={keyIndex++}>{match[1]}</MentionHighlight>);

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < value.length) {
      parts.push(<span key={keyIndex++}>{value.slice(lastIndex)}</span>);
    }

    return parts.length > 0 ? parts : value;
  };

  const highlightRef = React.useRef<HTMLDivElement>(null);

  /**
   * Syncs the highlight overlay scroll position with the textarea.
   */
  const handleScroll = React.useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  /**
   * Auto-resizes the textarea to fit its content.
   */
  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    // Reset height to get accurate scrollHeight
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <Container ref={containerRef}>
      {/* Mirror div for calculating @ position */}
      <Mirror ref={mirrorRef} aria-hidden="true" />

      {/* Highlight overlay */}
      <HighlightOverlay ref={highlightRef} $rows={rows}>
        {renderHighlightedText()}
      </HighlightOverlay>

      {/* Actual textarea */}
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onScroll={handleScroll}
        onPaste={onPaste}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
      />

      {mentionQuery !== null && (suggestions.length > 0 || isLoading) && (
        <SuggestionsPopup
          style={{
            top: mentionPosition.top,
            left: mentionPosition.left,
          }}
        >
          {isLoading ? (
            <LoadingItem>{t("Searching...")}</LoadingItem>
          ) : (
            suggestions.map((user, index) => (
              <SuggestionItem
                key={user.id}
                $isSelected={index === selectedIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(user);
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                {user.avatarUrl ? (
                  <UserAvatar src={user.avatarUrl} alt={user.name} />
                ) : (
                  <UserInitial>{user.name.charAt(0).toUpperCase()}</UserInitial>
                )}
                <UserName>{user.name}</UserName>
              </SuggestionItem>
            ))
          )}
        </SuggestionsPopup>
      )}
    </Container>
  );
}

const Container = styled.div`
  position: relative;
`;

const Mirror = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  visibility: hidden;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
  padding: 12px;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.5;
  width: 100%;
  pointer-events: none;
`;

const HighlightOverlay = styled.div<{ $rows: number }>`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12px;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
  word-break: break-word;
  pointer-events: none;
  color: ${s("text")};
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 8px;
`;

const MentionHighlight = styled.span`
  color: #1a56db;
  font-weight: 600;
`;

const Textarea = styled.textarea`
  width: 100%;
  padding: 12px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 8px;
  background: transparent;
  color: transparent;
  font-size: 14px;
  line-height: 1.5;
  resize: none;
  position: relative;
  z-index: 1;
  caret-color: ${s("text")};
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
  word-break: break-word;
  overflow-y: hidden;

  &:focus {
    outline: none;
    border-color: ${s("accent")};
  }

  &::placeholder {
    color: ${s("placeholder")};
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const SuggestionsPopup = styled.div`
  position: absolute;
  min-width: 200px;
  max-width: 300px;
  max-height: 200px;
  overflow-y: auto;
  background: ${s("menuBackground")};
  border: 1px solid ${s("inputBorder")};
  border-radius: 8px;
  box-shadow: ${s("menuShadow")};
  z-index: 1000;
`;

const SuggestionItem = styled.div<{ $isSelected: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  background: ${(props) => props.$isSelected ? s("menuItemSelected")(props) : "transparent"};
  
  &:hover {
    background: ${s("menuItemSelected")};
  }
`;

const LoadingItem = styled.div`
  padding: 12px;
  color: ${s("textSecondary")};
  text-align: center;
  font-size: 13px;
`;

const UserAvatar = styled.img`
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
`;

const UserInitial = styled.div`
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: ${s("accent")};
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
`;

const UserName = styled.span`
  font-size: 14px;
  color: ${s("text")};
`;

export default MentionInput;
