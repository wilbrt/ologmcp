/**
 * Shared regex-escaping utility.
 * Escapes special regex characters in a string so it can be used in a RegExp constructor.
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}