/**
 * Zero-width and invisible characters that are visually indistinguishable from
 * empty but differ byte-for-byte. We strip these during normalization so that
 * e.g. `Feature: Auth\u200D` and `Feature: Auth` compare equal. This also
 * blocks trivial spoofing attacks where a malicious Feature title inserts a
 * ZWJ to bypass duplicate detection.
 *
 * Includes: BOM (U+FEFF), ZWSP (U+200B), ZWNJ (U+200C), ZWJ (U+200D),
 * ZWNBSP (U+FEFF), directional marks (U+200E/F, U+202A-E), word joiner (U+2060).
 */
const INVISIBLE_CHARS_RE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

/**
 * ASCII control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F) that have
 * no place in a note title, alias, or body comparison string. Tab (0x09),
 * line feed (0x0A), and carriage return (0x0D) are preserved — downstream
 * whitespace collapse handles them. Stripping the rest blocks:
 *   - BEL/backspace terminal escape tricks in log output
 *   - Spoofed titles that render identically but compare differently
 *   - DEL (0x7F) used to bypass slug dedup checks
 * Without this, a record with `title: "Auth\x01"` would compare unequal to
 * `"Auth"` and slip past the duplicate / alias resolution checks.
 */
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Normalize a string for comparison: strip invisible chars, Unicode NFC,
 * trim, collapse whitespace, lowercase.
 * NFC ensures macOS NFD-encoded filenames compare equal to NFC-encoded ones.
 */
export function normalizeString(input: string): string {
  return input
    .replace(INVISIBLE_CHARS_RE, '')
    .replace(CONTROL_CHARS_RE, '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Normalize text for content hashing: strip invisible chars, Unicode NFC,
 * trim, collapse whitespace. Case is preserved (hashing is case-sensitive).
 * Deterministic regardless of line endings (CRLF vs LF), Unicode form
 * (NFC vs NFD), and invisible character pollution.
 */
export function normalizeForHash(text: string): string {
  return text
    .replace(INVISIBLE_CHARS_RE, '')
    .replace(CONTROL_CHARS_RE, '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ');
}
