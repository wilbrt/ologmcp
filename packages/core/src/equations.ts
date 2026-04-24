import type { PathEquation } from './ontology.js';
import { OlogStore } from './db.js';

/**
 * Validates that a name is a proper noun phrase.
 * It must start with an uppercase letter after an optional "a"/"an"/"the" prefix.
 */
export function isNounPhrase(name: string): boolean {
  const trimmed = name.trim();
  const withoutPrefix = trimmed.replace(/^(a|an|the)\s+/i, '');
  return /^[A-Z]/.test(withoutPrefix);
}

/**
 * Validates a path equation.
 * - Checks that lhs.src === rhs.src and lhs.tgt === rhs.tgt
 * - Checks that all arrow kinds in lhs.arrows and rhs.arrows exist in the
 *   database or are being proposed concurrently.
 */
export function validateEquation(
  eq: PathEquation,
  store: OlogStore,
  proposedArrowKinds?: string[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (eq.lhs.src !== eq.rhs.src) {
    errors.push(
      `Equation "${eq.name}": lhs source (${eq.lhs.src}) does not match rhs source (${eq.rhs.src})`,
    );
  }
  if (eq.lhs.tgt !== eq.rhs.tgt) {
    errors.push(
      `Equation "${eq.name}": lhs target (${eq.lhs.tgt}) does not match rhs target (${eq.rhs.tgt})`,
    );
  }

  const proposedSet = new Set(proposedArrowKinds ?? []);
  const allArrowKinds = new Set([...eq.lhs.arrows, ...eq.rhs.arrows]);

  for (const kind of allArrowKinds) {
    if (proposedSet.has(kind)) continue;
    if (!store.hasArrowKind(kind)) {
      errors.push(
        `Equation "${eq.name}": arrow kind "${kind}" does not exist in the database or concurrent proposal`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
