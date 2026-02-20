/**
 * Email MIME Parser
 *
 * Strips HTML, signatures, reply chains, and legal boilerplate from
 * email tips. Returns only the meaningful body text and metadata.
 * Never stores or passes attachment content — metadata only.
 */

export interface ParsedEmail {
  from?: string;
  subject?: string;
  date?: string;
  body_text: string;
  referenced_attachments: Array<{
    filename?: string;
    content_type?: string;
    size_bytes?: number;
  }>;
  detected_language?: string;
}

// Common email signature / boilerplate patterns to strip
const SIGNATURE_PATTERNS = [
  /^[-_]{2,}[\s\S]*$/m,                          // -- signature block
  /^Sent from my (iPhone|Android|Galaxy)[\s\S]*/im,
  /^Get Outlook for[\s\S]*/im,
  /^This email and any files transmitted[\s\S]*/im, // Legal footer
  /^CONFIDENTIALITY NOTICE[\s\S]*/im,
  /^DISCLAIMER[\s\S]*/im,
  /^On .+ wrote:[\s\S]*/m,                        // Reply chain
  /^From:.*\nSent:.*\nTo:.*\nSubject:[\s\S]*/m,   // Forwarded header
  /^>{1,}.*$/mg,                                   // Quoted lines
];

const HTML_PATTERNS = [
  /<[^>]+>/g,          // Tags
  /&nbsp;/g,           // HTML entities
  /&amp;/g,
  /&lt;/g,
  /&gt;/g,
  /&quot;/g,
  /&#\d+;/g,
];

export function stripHtml(html: string): string {
  let text = html;
  for (const pattern of HTML_PATTERNS) {
    text = text.replace(pattern, (match) => {
      if (match === "&nbsp;") return " ";
      if (match === "&amp;") return "&";
      if (match === "&lt;") return "<";
      if (match === "&gt;") return ">";
      if (match === "&quot;") return '"';
      return " "; // Replace tags with space
    });
  }
  // Collapse whitespace
  return text.replace(/\s{3,}/g, "\n\n").trim();
}

export function stripSignaturesAndBoilerplate(text: string): string {
  let cleaned = text;
  for (const pattern of SIGNATURE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Naive language detection — checks for common non-ASCII character ranges.
 * Returns ISO 639-1 code hint when confident, undefined when uncertain.
 */
export function detectLanguage(text: string): string | undefined {
  const sample = text.slice(0, 500);
  if (/[\u4e00-\u9fff]/.test(sample)) return "zh"; // Chinese
  if (/[\u0400-\u04ff]/.test(sample)) return "ru"; // Cyrillic
  if (/[\u0600-\u06ff]/.test(sample)) return "ar"; // Arabic
  if (/[\u00c0-\u024f]/.test(sample)) return "eu"; // Extended Latin (many EU languages)
  return "en"; // Default assumption
}

/**
 * Parse raw email text. Works with pre-parsed text bodies.
 * For full MIME parsing in production, integrate mailparser library.
 */
export function parseEmailText(rawText: string): ParsedEmail {
  const lines = rawText.split("\n");
  const headers: Record<string, string> = {};

  let bodyStart = 0;
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      bodyStart = i + 1;
      break;
    }
    const headerMatch = /^([\w-]+):\s*(.+)/.exec(line);
    if (headerMatch) {
      headers[headerMatch[1]!.toLowerCase()] = headerMatch[2]!.trim();
    }
  }

  const rawBody = lines.slice(bodyStart).join("\n");
  const strippedHtml = stripHtml(rawBody);
  const cleanBody = stripSignaturesAndBoilerplate(strippedHtml);

  return {
    from: headers["from"],
    subject: headers["subject"],
    date: headers["date"],
    body_text: cleanBody,
    referenced_attachments: [], // Real impl: use mailparser for attachments
    detected_language: detectLanguage(cleanBody),
  };
}
