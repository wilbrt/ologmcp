// @ts-check

const KIND_COLORS = {
  domain: '#FFD700',
  function: '#4A90D9',
  method: '#5B9BD5',
  'class': '#70AD47',
  interface: '#9B59B6',
  type: '#1ABC9C',
  import: '#95A5A6',
  module: '#7F8C8D',
  file: '#BDC3C7',
  property: '#E67E22',
  const: '#E74C3C',
  var: '#C0392B',
  enum: '#F39C12',
  namespace: '#2ECC71',
  other: '#ECF0F1',
};

let cy = null;
let currentSetId = null;
let eventSource = null;

document.addEventListener('DOMContentLoaded', () => {
  initCytoscape();
  loadSets();

  document.getElementById('set-selector').addEventListener('change', onSelectSet);
  document.getElementById('layout-selector').addEventListener('change', onLayoutChange);
  document.getElementById('refresh-btn').addEventListener('click', () => loadGraph(currentSetId));
});

function initCytoscape() {
  cy = cytoscape({
    container: document.getElementById('cy'),
    style: [
      {
        selector: 'node',
        style: {
          'label': 'data(label)',
          'background-color': 'data(color)',
          'color': '#fff',
          'text-outline-color': '#000',
          'text-outline-width': 2,
          'font-size': '11px',
          'text-valign': 'center',
          'text-halign': 'center',
          'width': 80,
          'height': 40,
          'shape': 'roundrectangle',
          'text-wrap': 'wrap',
          'text-max-width': '75px',
        },
      },
      {
        selector: 'edge',
        style: {
          'width': 2,
          'line-color': '#888',
          'target-arrow-color': '#888',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'label': 'data(label)',
          'font-size': '9px',
          'text-rotation': 'autorotate',
          'text-outline-color': '#1a1a2e',
          'text-outline-width': 2,
          'color': '#ccc',
          'text-wrap': 'wrap',
          'text-max-width': '80px',
        },
      },
      {
        selector: 'edge.synthetic',
        style: {
          'line-style': 'dashed',
          'line-color': '#ff9800',
          'target-arrow-color': '#ff9800',
        },
      },
      {
        selector: 'node:selected',
        style: {
          'border-width': 3,
          'border-color': '#bb86fc',
          'border-style': 'solid',
        },
      },
    ],
    layout: { name: 'cose', animate: true },
  });

  cy.on('tap', 'node', onNodeTap);
  cy.on('tap', 'edge', onEdgeTap);
  cy.on('tap', onBackgroundTap);
}

async function loadSets() {
  try {
    const resp = await fetch('/api/sets');
    const sets = await resp.json();
    const selector = document.getElementById('set-selector');
    selector.innerHTML = '';
    if (sets.length === 0) {
      selector.innerHTML = '<option value="">No working sets found</option>';
      return;
    }
    if (sets.length === 1) {
      const opt = document.createElement('option');
      opt.value = sets[0].id;
      opt.textContent = `${sets[0].name} (${sets[0].elementCount} elems, ${sets[0].arrowCount} arrows)`;
      selector.appendChild(opt);
      onSelectSet();
      return;
    }
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— Select a working set —';
    selector.appendChild(placeholder);
    for (const ws of sets) {
      const opt = document.createElement('option');
      opt.value = ws.id;
      opt.textContent = `${ws.name} (${ws.elementCount} elems, ${ws.arrowCount} arrows)`;
      selector.appendChild(opt);
    }
  } catch (err) {
    console.error('Failed to load sets:', err);
  }
}

async function onSelectSet() {
  const selector = document.getElementById('set-selector');
  const setId = selector.value;
  if (!setId) return;
  currentSetId = setId;
  await loadGraph(setId);
  connectSSE(setId);
}

async function loadGraph(setId) {
  if (!setId) return;
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = 'block';
  try {
    const resp = await fetch(`/api/sets/${setId}/graph?includeAnnotations=true`);
    const graph = await resp.json();

    cy.elements().remove();

    cy.add({
      nodes: graph.nodes.map(n => ({ data: n.data })),
      edges: graph.edges.map(e => ({ data: e.data, classes: e.classes })),
    });

    const layoutName = document.getElementById('layout-selector').value || 'cose';
    cy.layout({ name: layoutName, animate: true }).run();

    clearSidebar();
  } catch (err) {
    console.error('Failed to load graph:', err);
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

function onLayoutChange() {
  const layoutName = document.getElementById('layout-selector').value;
  if (cy && layoutName) {
    cy.layout({ name: layoutName, animate: true }).run();
  }
}

function onNodeTap(evt) {
  const node = evt.target;
  const data = node.data();
  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = `
    <h2>${data.label}</h2>
    <div class="field"><span class="label">ID</span><div class="value">${data.id}</div></div>
    <div class="field"><span class="label">Kind</span><div class="value">${data.kind}</div></div>
    ${data.module ? `<div class="field"><span class="label">Module</span><div class="value">${data.module}</div></div>` : ''}
    ${data.annotation ? `<div class="field"><span class="label">Note</span><div class="value">${data.annotation}</div></div>` : ''}
  `;
}

function onEdgeTap(evt) {
  const edge = evt.target;
  const data = edge.data();
  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = `
    <h2>${data.label}</h2>
    <div class="field"><span class="label">ID</span><div class="value">${data.id}</div></div>
    <div class="field"><span class="label">Source</span><div class="value">${data.source}</div></div>
    <div class="field"><span class="label">Target</span><div class="value">${data.target}</div></div>
    <div class="field"><span class="label">Synthetic</span><div class="value">${data.synthetic ? 'Yes' : 'No'}</div></div>
    ${data.annotation ? `<div class="field"><span class="label">Note</span><div class="value">${data.annotation}</div></div>` : ''}
  `;
}

function onBackgroundTap() {
  clearSidebar();
}

function clearSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = '<h2>Details</h2><p class="empty">Click a node or edge to inspect</p>';
}

function connectSSE(setId) {
  if (eventSource) {
    eventSource.close();
  }

  const status = document.getElementById('connection-status');
  status.textContent = 'Connecting…';
  status.className = 'disconnected';

  eventSource = new EventSource(`/api/sets/${setId}/stream`);

  eventSource.onopen = () => {
    status.textContent = 'Live';
    status.className = 'connected';
  };

  eventSource.addEventListener('updated', () => {
    console.log('Working set updated, reloading graph…');
    loadGraph(currentSetId);
  });

  eventSource.addEventListener('deleted', () => {
    console.log('Working set deleted');
    status.textContent = 'Deleted';
    status.className = 'disconnected';
    eventSource.close();
  });

  eventSource.onerror = () => {
    status.textContent = 'Disconnected';
    status.className = 'disconnected';
    // Auto-reconnect is handled by the browser's EventSource implementation
  };
}
