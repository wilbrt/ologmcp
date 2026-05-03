import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PathEquation, IntegrityConstraint } from '@olog/core';

export interface StoredPlan {
  operations: unknown[];
  hash: string;
  rationale: string;
  invariants: {
    equations: PathEquation[];
    constraints: IntegrityConstraint[];
  };
}

export const planStore: Map<string, StoredPlan> = new Map();

export function persistPlan(hash: string, plan: StoredPlan, projectRoot: string): void {
  planStore.set(hash, plan);
  const dir = join(projectRoot, '.olog', 'plans');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${hash}.json`), JSON.stringify(plan, null, 2));
}

export function loadPlan(hash: string, projectRoot: string): StoredPlan | undefined {
  const cached = planStore.get(hash);
  if (cached) return cached;
  const filePath = join(projectRoot, '.olog', 'plans', `${hash}.json`);
  try {
    const content = readFileSync(filePath, 'utf-8');
    const plan: StoredPlan = JSON.parse(content);
    planStore.set(hash, plan);
    return plan;
  } catch {
    return undefined;
  }
}