/**
 * Motif discovery types.
 *
 * A motif is a recurring structural pattern in the olog graph — formally,
 * a strongly meaningful functor from a small template olog to the codebase olog.
 *
 * The types here mirror the domain discovery session model (start/refine/commit)
 * and are persisted via MotifSessionStore + motif template/instance tables.
 */

import type { ConfidenceLevel } from '../ontology.js';
import type { MiningOptions } from './index.js';

// ── Ego ──

/** Induced subgraph around a seed element, produced by ego-graph extraction. */
export interface EgoGraph {
  /** The seed element ID that this ego-graph was expanded from. */
  seedId: string;
  /** The kind of the seed element. */
  seedKind: string;
  /** All elements in the ego-graph, keyed by element ID. */
  elements: Map<string, { id: string; kind: string; name: string }>;
  /** All arrows in the ego-graph. */
  arrows: Array<{ srcId: string; kind: string; dstId: string }>;
}

// ── Group ──

/** A group of ego-graphs that share the same shape, filtered by minimum support. */
export interface ShapeGroup {
  /** The canonical shape shared by all instances. */
  shape: MotifShape;
  /** The concrete ego-graph instances matching this shape. */
  instances: EgoGraph[];
  /** Count of instances (same as instances.length after filtering). */
  support: number;
}

// ── Shape ──

/** A canonical shape template: kind-abstracted objects and arrow labels. */
export interface MotifShape {
  /** Deterministic hash for fast grouping (JSON of sorted objects + arrows). */
  hash: string;
  /** Object slots, each a role label and element kind. */
  objects: Array<{ role: string; kind: string }>;
  /** Arrow slots: fromRole → toRole labeled with an arrow kind. */
  arrows: Array<{ fromRole: string; label: string; toRole: string }>;
}

// ── Instance ──

/** A single concrete mapping from shape roles to real olog elements. */
export interface MotifInstance {
  id: string;
  /** Shape role → concrete olog element ID. */
  mappings: Record<string, string>;
  /** Module of the seed element, for grouping and display. */
  module: string | null;
}

// ── Candidate ──

/** A motif candidate produced by discovery, ready for user review. */
export interface MotifCandidate {
  id: string;
  /** The canonical shape of this motif. */
  shape: MotifShape;
  /** Auto-generated or user-overridden name. */
  proposedName: string;
  /** Human-readable description of what structural pattern this captures. */
  description: string;
  /** Number of concrete instances found in the olog. */
  support: number;
  /** Concrete instance mappings. */
  instances: MotifInstance[];
  /** Internal equations that hold for all instances (mined via Tier 1). */
  equations: Array<{
    lhsPath: string[];
    rhsPath: string[];
    coverage: number;
  }>;
  /** Clarifying questions for the user. */
  questions: string[];
  status: 'proposed' | 'accepted' | 'rejected' | 'deferred';
}

// ── Options ──

export interface MotifDiscoveryOptions {
  /** Element kinds to use as seeds (default: ['function', 'class', 'interface']). */
  seedKinds?: string[];
  /** Ego-graph expansion depth (default: 2). */
  depth?: number;
  /** Arrow kinds to follow during expansion (default: all in use). */
  arrowKinds?: string[];
  /** Minimum support (instance count) for a motif to be surfaced (default: 3). */
  minSupport?: number;
  /** Whether to mine equations internal to each motif (default: true). */
  mineEquations?: boolean;
  /** Options passed through to mineEquations when mineEquations=true. */
  equationOptions?: Partial<MiningOptions>;
  /** Regex to scope seeds to specific modules (default: none = all). */
  scopeRegex?: string;
  /** Exclude modules matching these patterns. */
  excludeModules?: string[];
}

// ── Session ──

export interface MotifSessionData {
  id: string;
  status: 'active' | 'committed' | 'abandoned';
  scopeRegex: string | null;
  candidates: MotifCandidate[];
  commitSha: string;
  createdAt: number;
  updatedAt: number;
}

// ── Persisted templates ──

/** A committed motif template stored in the olog. */
export interface MotifTemplate {
  id: string;
  name: string;
  description: string;
  shape: MotifShape;
  equations: Array<{
    lhsPath: string[];
    rhsPath: string[];
    coverage: number;
  }>;
  provenance: {
    source: 'mining' | 'manual' | 'llm';
    commitSha: string;
    confidence: ConfidenceLevel;
  };
}