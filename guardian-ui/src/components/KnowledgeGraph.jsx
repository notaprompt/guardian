import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from 'd3-force';
import useStore from '../store';
import '../styles/knowledge-graph.css';

// ── Entity type → color mapping (void architecture palette) ──

const TYPE_COLORS = {
  person:   '#E8DCC8',  // warm glow
  concept:  '#7BA4D4',  // resolve blue
  project:  '#5BF29B',  // alive green
  decision: '#D4A843',  // caution amber
  question: '#C4B8A0',  // thinking warm
};

const TYPE_COLOR_DIM = {
  person:   'rgba(232,220,200,0.15)',
  concept:  'rgba(123,164,212,0.15)',
  project:  'rgba(91,242,155,0.15)',
  decision: 'rgba(212,168,67,0.15)',
  question: 'rgba(196,184,160,0.15)',
};

function getTypeColor(type) {
  return TYPE_COLORS[type] || '#E8DCC8';
}

// ── Component ──────────────────────────────────────────────────

function KnowledgeGraphInner() {
  const canvasRef = useRef(null);
  const simRef = useRef(null);
  const animRef = useRef(null);
  const renderRef = useRef(null);
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const dragRef = useRef(null);
  const hoveredRef = useRef(null);

  const entities = useStore((s) => s.graphEntities);
  const relationships = useStore((s) => s.graphRelationships);
  const graphLoading = useStore((s) => s.graphLoading);
  const fetchGraph = useStore((s) => s.fetchGraph);
  const resumeSession = useStore((s) => s.resumeSession);

  const [tooltip, setTooltip] = useState(null);
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [entitySessions, setEntitySessions] = useState([]);

  // Request a single render frame when the simulation is idle (for pan/zoom/hover)
  const requestRender = useCallback(() => {
    if (!animRef.current && renderRef.current) {
      animRef.current = requestAnimationFrame(renderRef.current);
    }
  }, []);

  // Fetch graph data on mount
  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // Load sessions for selected entity
  useEffect(() => {
    if (!selectedEntity) {
      setEntitySessions([]);
      return;
    }
    // Derive sessions from relationships
    const sessionIds = new Set();
    for (const r of relationships) {
      if (
        (r.source_entity_id === selectedEntity.id || r.target_entity_id === selectedEntity.id) &&
        r.session_id
      ) {
        sessionIds.add(r.session_id);
      }
    }
    // Fetch actual session details from the graph sessions API
    if (window.guardian?.graph?.entitySessions) {
      window.guardian.graph.entitySessions(selectedEntity.id).then((result) => {
        if (result?.ok) {
          setEntitySessions(result.sessions || []);
        }
      });
    }
  }, [selectedEntity, relationships]);

  // Build and run d3-force simulation
  useEffect(() => {
    if (!entities.length) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = canvas.parentElement.clientWidth;
    const height = canvas.parentElement.clientHeight;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    // Reset transform to center
    transformRef.current = { x: width / 2, y: height / 2, k: 1 };

    // Build nodes and links from entities/relationships
    const nodeMap = {};
    const nodes = entities.map((e) => {
      const node = {
        id: e.id,
        name: e.name,
        type: e.type,
        mentionCount: e.mention_count || 1,
        radius: Math.max(6, Math.min(24, 4 + Math.sqrt(e.mention_count || 1) * 4)),
      };
      nodeMap[e.id] = node;
      return node;
    });

    const links = relationships
      .filter((r) => nodeMap[r.source_entity_id] && nodeMap[r.target_entity_id])
      .map((r) => ({
        source: r.source_entity_id,
        target: r.target_entity_id,
        type: r.type,
        id: r.id,
      }));

    // Create simulation
    const sim = forceSimulation(nodes)
      .force('link', forceLink(links).id((d) => d.id).distance(80).strength(0.3))
      .force('charge', forceManyBody().strength(-120).distanceMax(300))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide().radius((d) => d.radius + 4))
      .alphaDecay(0.02)
      .velocityDecay(0.4);

    simRef.current = { sim, nodes, links, nodeMap };

    // Render loop
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio;

    function render() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const t = transformRef.current;
      ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);

      // Draw edges
      for (const link of links) {
        const source = typeof link.source === 'object' ? link.source : nodeMap[link.source];
        const target = typeof link.target === 'object' ? link.target : nodeMap[link.target];
        if (!source || !target) continue;

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.strokeStyle = 'rgba(232, 220, 200, 0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Edge label at midpoint
        const mx = (source.x + target.x) / 2;
        const my = (source.y + target.y) / 2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.font = `${8 / t.k < 6 ? 0 : 8}px JetBrains Mono, monospace`;
        if (8 / t.k >= 6 && t.k >= 0.5) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(link.type.replace(/_/g, ' '), mx, my - 6);
        }
      }

      // Draw nodes
      const hovered = hoveredRef.current;
      for (const node of nodes) {
        const isHovered = hovered && hovered.id === node.id;
        const isSelected = selectedEntity && selectedEntity.id === node.id;
        const color = getTypeColor(node.type);

        // Glow effect for hovered/selected
        if (isHovered || isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2);
          ctx.fillStyle = TYPE_COLOR_DIM[node.type] || 'rgba(232,220,200,0.1)';
          ctx.fill();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = isHovered || isSelected
          ? color
          : color.replace(')', ', 0.7)').replace('rgb', 'rgba');
        ctx.fill();

        // Border
        ctx.strokeStyle = isSelected
          ? color
          : 'rgba(232, 220, 200, 0.15)';
        ctx.lineWidth = isSelected ? 2 : 0.5;
        ctx.stroke();

        // Label
        if (t.k >= 0.4) {
          ctx.fillStyle = isHovered || isSelected
            ? 'rgba(255, 255, 255, 0.9)'
            : 'rgba(255, 255, 255, 0.5)';
          ctx.font = `${Math.max(9, 11)}px JetBrains Mono, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(node.name, node.x, node.y + node.radius + 4);
        }
      }

      ctx.restore();

      // Stop the animation loop when the simulation has settled
      if (sim.alpha() < sim.alphaMin()) {
        animRef.current = null;
      } else {
        animRef.current = requestAnimationFrame(render);
      }
    }

    // Store render function for requestRender() to call when simulation is idle
    renderRef.current = render;

    // Schedule a render on every simulation tick while it's active
    sim.on('tick', () => {
      if (!animRef.current) {
        animRef.current = requestAnimationFrame(render);
      }
    });
    animRef.current = requestAnimationFrame(render);

    return () => {
      sim.stop();
      renderRef.current = null;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [entities, relationships, selectedEntity]);

  // ── Mouse interaction handlers ──────────────────────────────

  const screenToWorld = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const t = transformRef.current;
    return {
      x: (clientX - rect.left - t.x) / t.k,
      y: (clientY - rect.top - t.y) / t.k,
    };
  }, []);

  const findNodeAt = useCallback((worldX, worldY) => {
    if (!simRef.current) return null;
    const { nodes } = simRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = worldX - n.x;
      const dy = worldY - n.y;
      if (dx * dx + dy * dy < (n.radius + 4) * (n.radius + 4)) {
        return n;
      }
    }
    return null;
  }, []);

  const handleMouseMove = useCallback((e) => {
    const world = screenToWorld(e.clientX, e.clientY);

    // Handle dragging a node
    if (dragRef.current) {
      const node = dragRef.current;
      node.fx = world.x;
      node.fy = world.y;
      simRef.current?.sim.alpha(0.1).restart();
      return;
    }

    // Handle panning
    if (e.buttons === 1 && !dragRef.current) {
      transformRef.current.x += e.movementX;
      transformRef.current.y += e.movementY;
      requestRender();
      return;
    }

    // Hover detection
    const node = findNodeAt(world.x, world.y);
    const prev = hoveredRef.current;
    hoveredRef.current = node;

    if (node) {
      const rect = canvasRef.current.getBoundingClientRect();
      setTooltip({
        x: e.clientX - rect.left + 12,
        y: e.clientY - rect.top - 8,
        name: node.name,
        type: node.type,
        mentionCount: node.mentionCount,
      });
      if (!prev || prev.id !== node.id) requestRender();
    } else {
      setTooltip(null);
      if (prev) requestRender();
    }
  }, [screenToWorld, findNodeAt, requestRender]);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    const world = screenToWorld(e.clientX, e.clientY);
    const node = findNodeAt(world.x, world.y);

    if (node) {
      dragRef.current = node;
      node.fx = node.x;
      node.fy = node.y;
      simRef.current?.sim.alphaTarget(0.05).restart();
    }
  }, [screenToWorld, findNodeAt]);

  const handleMouseUp = useCallback(() => {
    if (dragRef.current) {
      dragRef.current.fx = null;
      dragRef.current.fy = null;
      simRef.current?.sim.alphaTarget(0);
      dragRef.current = null;
    }
  }, []);

  const handleClick = useCallback((e) => {
    const world = screenToWorld(e.clientX, e.clientY);
    const node = findNodeAt(world.x, world.y);

    if (node) {
      const entity = entities.find((ent) => ent.id === node.id);
      setSelectedEntity(entity || null);
    } else {
      setSelectedEntity(null);
    }
  }, [screenToWorld, findNodeAt, entities]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const t = transformRef.current;

    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newK = Math.max(0.1, Math.min(5, t.k * factor));

    // Zoom toward cursor
    t.x = mouseX - (mouseX - t.x) * (newK / t.k);
    t.y = mouseY - (mouseY - t.y) * (newK / t.k);
    t.k = newK;
    requestRender();
  }, [requestRender]);

  // Attach wheel listener with passive: false
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Resize handler
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth * window.devicePixelRatio;
      canvas.height = parent.clientHeight * window.devicePixelRatio;
      canvas.style.width = parent.clientWidth + 'px';
      canvas.style.height = parent.clientHeight + 'px';
    });
    observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, []);

  // ── Render ───────────────────────────────────────────────────

  if (graphLoading) {
    return (
      <div className="knowledge-graph">
        <div className="knowledge-graph__loading">
          <div className="knowledge-graph__loading-dot" />
          <span>Loading graph...</span>
        </div>
      </div>
    );
  }

  if (!entities.length) {
    return (
      <div className="knowledge-graph">
        <div className="knowledge-graph__empty">
          <div className="knowledge-graph__empty-icon">&#9672;</div>
          <span>No entities extracted yet</span>
          <span style={{ fontSize: 10, color: 'var(--white-20)' }}>
            Entities are extracted from conversations automatically
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="knowledge-graph">
      <canvas
        ref={canvasRef}
        className="knowledge-graph__canvas"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
      />

      {/* Tooltip on hover */}
      {tooltip && !selectedEntity && (
        <div
          className="knowledge-graph__tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="knowledge-graph__tooltip-name">{tooltip.name}</div>
          <div className="knowledge-graph__tooltip-type">{tooltip.type}</div>
          <div className="knowledge-graph__tooltip-count">
            {tooltip.mentionCount} mention{tooltip.mentionCount !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Detail panel for selected entity */}
      {selectedEntity && (
        <div className="knowledge-graph__detail">
          <div className="knowledge-graph__detail-header">
            <div className="knowledge-graph__detail-name">{selectedEntity.name}</div>
            <button
              className="knowledge-graph__detail-close"
              onClick={() => setSelectedEntity(null)}
            >
              x
            </button>
          </div>
          <div className="knowledge-graph__detail-meta">
            <span>{selectedEntity.type}</span>
            <span>{selectedEntity.mention_count || 1} mentions</span>
          </div>
          {entitySessions.length > 0 && (
            <div className="knowledge-graph__detail-section">
              <div className="knowledge-graph__detail-label">sessions</div>
              {entitySessions.map((s) => (
                <div
                  key={s.id}
                  className="knowledge-graph__detail-session"
                  onClick={() => resumeSession(s.id)}
                >
                  {s.title || 'Untitled'} — {s.started_at?.slice(0, 10)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="knowledge-graph__legend">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="knowledge-graph__legend-item">
            <div
              className="knowledge-graph__legend-dot"
              style={{ background: color }}
            />
            <span>{type}</span>
          </div>
        ))}
      </div>

      {/* Status */}
      <div className="knowledge-graph__status">
        {entities.length} entities, {relationships.length} connections
      </div>
    </div>
  );
}

export default React.memo(KnowledgeGraphInner);
