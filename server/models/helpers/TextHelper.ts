import { JSDOM } from "jsdom";
import chunk from "lodash/chunk";
import escapeRegExp from "lodash/escapeRegExp";
import { AttachmentPreset } from "@shared/types";
import attachmentCreator from "@server/commands/attachmentCreator";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import { trace } from "@server/logging/tracing";
import type { User } from "@server/models";
import { Attachment } from "@server/models";
import FileStorage from "@server/storage/files";
import type { APIContext } from "@server/types";
import parseAttachmentIds from "@server/utils/parseAttachmentIds";
import parseImages from "@server/utils/parseImages";
import { isInternalUrl } from "@shared/utils/urls";

@trace()
export class TextHelper {
  /**
   * Converts attachment urls in documents to signed equivalents that allow
   * direct access without a session cookie
   *
   * @param text The text either html or markdown which contains urls to be converted
   * @param teamId The team context
   * @param expiresIn The time that signed urls should expire (in seconds)
   * @returns The replaced text
   */
  static async attachmentsToSignedUrls(
    text: string,
    teamId: string,
    expiresIn = 3000
  ) {
    const attachmentIds = parseAttachmentIds(text);

    await Promise.all(
      attachmentIds.map(async (id) => {
        const attachment = await Attachment.findOne({
          where: {
            id,
            teamId,
          },
        });

        if (attachment) {
          const signedUrl = await FileStorage.getSignedUrl(
            attachment.key,
            expiresIn
          );

          text = text.replace(
            new RegExp(escapeRegExp(attachment.redirectUrl), "g"),
            signedUrl
          );
        }
      })
    );
    return text;
  }

  /**
   * Converts attachment urls in documents to base64 data URIs for embedding
   * in documents like Word files that need self-contained images.
   * Also simplifies HTML structure for better html-to-docx compatibility.
   *
   * @param html The HTML text which contains attachment urls to be converted
   * @param teamId The team context
   * @returns The HTML with attachment urls replaced by base64 data URIs
   */
  static async attachmentsToDataUrls(
    html: string,
    teamId: string
  ) {
    Logger.debug("task", `Starting attachmentsToDataUrls for team ${teamId}`);
    Logger.debug("task", `HTML length: ${html.length}`);

    // Parse HTML with JSDOM for proper DOM manipulation
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Find all img elements
    const images = doc.querySelectorAll("img");
    Logger.debug("task", `Found ${images.length} img elements in HTML`);

    let convertedCount = 0;

    // First pass: convert all attachment URLs to data URLs
    for (const img of Array.from(images)) {
      const src = img.getAttribute("src");
      if (!src) {
        continue;
      }

      // Check if this is an attachment URL
      const match = src.match(/\/api\/attachments\.redirect\?id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (!match) {
        Logger.debug("task", `Skipping non-attachment image: ${src.substring(0, 100)}`);
        continue;
      }

      const attachmentId = match[1];
      Logger.debug("task", `Processing attachment: ${attachmentId}`);

      try {
        const attachment = await Attachment.findOne({
          where: {
            id: attachmentId,
            teamId,
          },
        });

        if (attachment) {
          Logger.debug("task", `Found attachment ${attachmentId}, contentType: ${attachment.contentType}`);
          const buffer = await attachment.buffer;
          const mimeType = attachment.contentType || "image/png";
          const base64 = buffer.toString("base64");
          const dataUrl = `data:${mimeType};base64,${base64}`;

          // Set the src to the data URL
          img.setAttribute("src", dataUrl);

          // Remove contentEditable attribute which can cause issues
          img.removeAttribute("contenteditable");

          // Ensure alt attribute exists
          if (!img.getAttribute("alt")) {
            img.setAttribute("alt", "image");
          }

          // Mark this image as converted for later unwrapping
          img.setAttribute("data-converted", "true");

          convertedCount++;
          Logger.debug("task", `Successfully converted attachment ${attachmentId} to data URL`);
        } else {
          Logger.warn("Attachment not found", { attachmentId, teamId });
        }
      } catch (err) {
        Logger.warn("Failed to convert attachment to data URL", {
          attachmentId,
          teamId,
          error: err.message,
        });
      }
    }

    Logger.debug("task", `Converted ${convertedCount} attachments to data URLs`);

    // Second pass: unwrap images from div.image wrappers (html-to-docx handles img directly better)
    // Find all div.image elements and simplify the structure
    const imageWrappers = doc.querySelectorAll("div.image");
    Logger.debug("task", `Found ${imageWrappers.length} div.image wrappers to unwrap`);

    for (const wrapper of Array.from(imageWrappers)) {
      const img = wrapper.querySelector("img");
      if (img) {
        // Create a simple paragraph with just the image
        const p = doc.createElement("p");
        const newImg = doc.createElement("img");

        // Copy essential attributes
        newImg.setAttribute("src", img.getAttribute("src") || "");
        newImg.setAttribute("alt", img.getAttribute("alt") || "image");
        if (img.getAttribute("width")) {
          newImg.setAttribute("width", img.getAttribute("width") || "");
        }
        if (img.getAttribute("height")) {
          newImg.setAttribute("height", img.getAttribute("height") || "");
        }

        p.appendChild(newImg);
        wrapper.replaceWith(p);
        Logger.debug("task", `Unwrapped image from div.image wrapper`);
      }
    }

    // Return just the body content, not the full HTML document
    // html-to-docx expects HTML content, not a full document
    const result = doc.body.innerHTML;
    Logger.debug("task", `Result HTML length: ${result.length}`);
    return result;
  }

  /**
   * Replaces remote and base64 encoded images in the given text with attachment
   * urls and uploads the images to the storage provider.
   *
   * @param ctx The API context
   * @param markdown The text to replace the images in
   * @param user The user context
   * @returns The text with the images replaced
   */
  static async replaceImagesWithAttachments(
    ctx: APIContext,
    markdown: string,
    user: User,
    options: {
      /** If true, only process base64 encoded images */
      base64Only?: boolean;
    } = {}
  ) {
    let output = markdown;
    const images = parseImages(markdown);
    const timeoutPerImage = Math.floor(
      Math.min(env.REQUEST_TIMEOUT / images.length, 10000)
    );
    const chunks = chunk(images, 10);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (image) => {
          // Skip attempting to fetch images that are not valid urls
          try {
            new URL(image.src);
          } catch (_e) {
            return;
          }

          if (isInternalUrl(image.src)) {
            return;
          }
          if (options.base64Only && !image.src.startsWith("data:")) {
            return;
          }

          try {
            const attachment = await attachmentCreator({
              name: image.alt ?? "image",
              url: image.src,
              preset: AttachmentPreset.DocumentAttachment,
              user,
              fetchOptions: {
                timeout: timeoutPerImage,
              },
              ctx,
            });

            if (attachment) {
              output = output.replace(
                new RegExp(escapeRegExp(image.src), "g"),
                attachment.redirectUrl
              );
            }
          } catch (err) {
            Logger.warn("Failed to download image for attachment", {
              error: err.message,
              src: image.src,
            });
          }
        })
      );
    }

    return output;
  }
}
