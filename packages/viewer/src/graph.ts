import type { WorkingSetGraph, OlogElem, OlogArr, SyntheticArr } from '@olog/core';

/**
 * Color map for element kinds used in Cytoscape node styling.
 */
export const KIND_COLORS: Record<string, string> = {
  domain: '#FFD700',     // gold
  function: '#4A90D9',   // blue
  method: '#5B9BD5',    // light blue
  class: '#70AD47',     // green
  interface: '#9B59B6', // purple
  type: '#1ABC9C',      // teal
  import: '#95A5A6',    // gray
  module: '#7F8C8D',    // dark gray
  file: '#BDC3C7',      // silver
  property: '#E67E22',  // orange
  const: '#E74C3C',     // red
  var: '#C0392B',       // dark red
  enum: '#F39C12',      // amber
  namespace: '#2ECC71', // emerald
  other: '#ECF0F1',     // near-white
};

interface CytoscapeNode {
  group: 'nodes';
  data: {
    id: string;
    label: string;
    kind: string;
    module: string | null;
    annotation: string | null;
    color: string;
  };
}

interface CytoscapeEdge {
  group: 'edges';
  data: {
    id: string;
    source: string;
    target: string;
    label: string;
    synthetic: boolean;
    annotation: string | null;
  };
  classes: string;
}

export interface CytoscapeGraph {
  nodes: CytoscapeNode[];
  edges: CytoscapeEdge[];
}

/**
 * Transform a WorkingSetGraph from OlogStore into Cytoscape.js-compatible JSON.
 *
 * - Each element becomes a node with a kind-based CSS class and color.
 * - Each real arrow becomes a solid edge with its kind as label.
 * - Each synthetic arrow becomes a dashed edge (class "synthetic") with its kind as label.
 * - Annotations are carried as `data.annotation` on both nodes and edges.
 */
export function toCytoscapeGraph(graph: WorkingSetGraph): CytoscapeGraph {
  const nodes: CytoscapeNode[] = [];
  const edges: CytoscapeEdge[] = [];

  // Build a set of element IDs that are in the working set, so we only
  // include arrows between known elements.
  const elemIds = new Set(graph.elements.map((e: OlogElem) => e.id));

  for (const elem of graph.elements) {
    const annotation = (elem as any).annotation ?? null;
    const color: string = KIND_COLORS[elem.kind] ?? KIND_COLORS.other!;
    nodes.push({
      group: 'nodes',
      data: {
        id: elem.id,
        label: elem.name,
        kind: elem.kind,
        module: elem.module ?? null,
        annotation,
        color,
      },
    });
  }

  // Real arrows
  for (const arr of graph.arrows) {
    if (!elemIds.has(arr.srcId) || !elemIds.has(arr.dstId)) continue;
    const annotation = (arr as any).annotation ?? null;
    edges.push({
      group: 'edges',
      data: {
        id: arr.id,
        source: arr.srcId,
        target: arr.dstId,
        label: arr.kind,
        synthetic: false,
        annotation,
      },
      classes: '',
    });
  }

  // Synthetic arrows
  for (const sarr of graph.syntheticArrows) {
    // Synthetic arrows may have dstId === null (unknown destination)
    const target = sarr.dstId ?? '';
    if (!sarr.srcId) continue;
    const annotation = (sarr as any).annotation ?? sarr.note ?? null;
    edges.push({
      group: 'edges',
      data: {
        id: sarr.id,
        source: sarr.srcId,
        target: target || sarr.srcId, // self-loop if no target
        label: sarr.kind,
        synthetic: true,
        annotation,
      },
      classes: 'synthetic',
    });
  }

  return { nodes, edges };
}
