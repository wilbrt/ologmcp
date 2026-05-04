import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plan } from '@olog/core';

export const planStore: Map<string, Plan> = new Map();

export function persistPlan(hash: string, plan: Plan, projectRoot: string): void {
  planStore.set(hash, plan);
  const dir = join(projectRoot, '.olog', 'plans');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${hash}.json`), JSON.stringify(plan, null, 2));
}

export function loadPlan(hash: string, projectRoot: string): Plan | undefined {
  const cached = planStore.get(hash);
  if (cached) return cached;
  const filePath = join(projectRoot, '.olog', 'plans', `${hash}.json`);
  try {
    const content = readFileSync(filePath, 'utf-8');
    const plan: Plan = JSON.parse(content);
    planStore.set(hash, plan);
    return plan;
  } catch {
    return undefined;
  }
}
