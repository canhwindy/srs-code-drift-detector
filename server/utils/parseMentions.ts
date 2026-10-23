import { User } from "@server/models";

import Logger from "@server/logging/Logger";

/**
 * Extracts @mentions from text content and finds matching users.
 *
 * @param content - the text content to parse for @mentions.
 * @param teamId - the team ID to search for users in.
 * @returns an array of user IDs that were mentioned.
 */
export async function parseMentions(
  content: string,
  teamId: string
): Promise<string[]> {
  Logger.debug("task", `Starting mention parsing for content: "${content}"`);

  // First, get all users from the team to match against
  const allUsers = await User.findAll({
    where: { teamId },
    attributes: ["id", "name"],
  });

  Logger.debug("task", `Found ${allUsers.length} users in team ${teamId}`);

  const mentionedUserIds: string[] = [];

  // Check if each user's name appears after @ in the content
  for (const user of allUsers) {
    // Create a regex pattern that matches @username (case insensitive)
    // The username can be followed by ZWSP (from mention insertion), space, punctuation, or end of string
    const escapedName = user.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`@${escapedName}(?:\\u200B|\\s|[.,!?;:]|$)`, "i");

    if (pattern.test(content)) {
      mentionedUserIds.push(user.id);
      Logger.debug("task", `Found mention for user: ${user.name} (${user.id})`);
    }
  }

  Logger.info("task", `Mention parsing complete`, {
    content,
    foundMentions: mentionedUserIds.length,
    mentionedUserIds,
  });

  return mentionedUserIds;
}

/**
 * Extracts raw mention strings from content without database lookup.
 *
 * @param content - the text content to parse for @mentions.
 * @returns an array of mentioned names (without the @ symbol).
 */
export function extractMentionNames(content: string): string[] {
  // Match @name followed by ZWSP (from mention insertion), space, punctuation, or end of string
  const mentionPattern = /@([\w\u00C0-\u024F\u1E00-\u1EFF][\w\u00C0-\u024F\u1E00-\u1EFF\s]*?)(?=\u200B|\s@|\s*$|[.,!?;:\n]|\s{2,})/g;

  const mentions: string[] = [];
  let match;

  while ((match = mentionPattern.exec(content)) !== null) {
    const name = match[1].trim();
    if (name) {
      mentions.push(name);
    }
  }

  return mentions;
}
