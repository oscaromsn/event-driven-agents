<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import dagre from "dagre";

  type ServiceNode = {
    id: string;
    name: string;
    publishes: string[];
    subscribes: string[];
  };

  type GraphEdge = {
    from: string;
    to: string;
    eventType: string;
    edgeType: "event";
  };

  type StateEdge = {
    from: string;
    to: string;
    label: string;
    edgeType: "state";
  };

  type GraphStructure = {
    nodes: ServiceNode[];
    edges: GraphEdge[];
    stateEdges: StateEdge[];
  };

  type LayoutNode = {
    name: string;
    x: number;
    y: number;
  };

  type LayoutEdge = {
    from: string;
    to: string;
    eventType: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
  };

  type Particle = {
    id: string;
    from: string;
    to: string;
    x: number;
    y: number;
    color: string;
    startTime: number;
  };

  let ws: WebSocket | null = $state(null);
  let graph: GraphStructure | null = $state(null);
  let layoutNodes: LayoutNode[] = $state([]);
  let layoutEdges: LayoutEdge[] = $state([]);
  let uniqueEdges: LayoutEdge[] = $state([]); // Deduplicated event edges for rendering
  let stateEdges: LayoutEdge[] = $state([]); // State subscription edges
  let particles: Particle[] = $state([]);
  let recentEvents: Array<{ eventType: string; timestamp: number }> = $state(
    [],
  );
  let viewBox = $state("0 0 800 600");

  const nodeRadius = 30;

  const EVENT_COLORS: Record<string, string> = {
    user_message: "#3B82F6",
    execution_approved: "#10B981",
    execution_rejected: "#EF4444",
    interrupt_requested: "#F59E0B",
    llm_response_started: "#A855F7",
    llm_text_chunk: "#A855F7",
    llm_response_completed: "#A855F7",
    llm_stream_interrupted: "#EF4444",
    command_requested: "#10B981",
    command_started: "#10B981",
    command_completed: "#10B981",
    command_failed: "#EF4444",
    interrupt_cleanup_completed: "#F59E0B",
  };

  function getEventColor(eventType: string): string {
    // Handle state update events
    if (eventType.includes("state update")) {
      const serviceName = eventType.split(" ")[0]; // Extract service name
      const serviceColors: Record<string, string> = {
        MessagesState: "#3B82F6", // Blue
        UIDisplayState: "#8B5CF6", // Purple
        CommandState: "#10B981", // Green
        InterruptState: "#F59E0B", // Orange
        VisualizerSink: "#6B7280", // Gray
      };
      return serviceColors[serviceName] || "#9CA3AF";
    }
    return EVENT_COLORS[eventType] || "#6B7280";
  }

  onMount(() => {
    ws = new WebSocket("ws://localhost:3457/visualizer");

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "graph_structure") {
        console.log("[Visualizer] Received graph structure");
        graph = data.data;
        computeLayout();
      } else if (data.type === "live_event") {
        handleLiveEvent(data.event, data.timestamp);
      }
    };

    ws.onerror = (error) => {
      console.error("[Visualizer] WebSocket error:", error);
    };

    ws.onclose = () => {
      console.log("[Visualizer] WebSocket closed");
    };
  });

  onDestroy(() => {
    if (ws) ws.close();
  });

  function computeLayout() {
    if (!graph) return;

    // Create dagre graph
    const g = new dagre.graphlib.Graph();

    // Set graph options - TB = top to bottom, LR = left to right
    g.setGraph({
      rankdir: "TB",
      ranksep: 100, // Vertical spacing between ranks
      nodesep: 80, // Horizontal spacing between nodes
      edgesep: 30,
      marginx: 50,
      marginy: 50,
    });

    g.setDefaultEdgeLabel(() => ({}));

    // Add nodes
    graph.nodes.forEach((n) => {
      g.setNode(n.name, {
        label: n.name,
        width: nodeRadius * 2,
        height: nodeRadius * 2,
      });
    });

    // Add event edges
    graph.edges.forEach((e) => {
      g.setEdge(e.from, e.to);
    });

    // Add state edges
    graph.stateEdges.forEach((e) => {
      g.setEdge(e.from, e.to);
    });

    // Compute layout
    dagre.layout(g);

    // Get graph bounds
    const graphWidth = g.graph().width || 800;
    const graphHeight = g.graph().height || 600;

    // Calculate padding and viewBox to center the graph
    const padding = 50;
    viewBox = `${-padding} ${-padding} ${graphWidth + padding * 2} ${graphHeight + padding * 2}`;

    // Extract node positions
    layoutNodes = graph.nodes.map((n) => {
      const node = g.node(n.name);
      return {
        name: n.name,
        x: node.x,
        y: node.y,
      };
    });

    // Compute edge positions with arrow adjustment
    layoutEdges = graph.edges.map((e) => {
      const source = g.node(e.from);
      const target = g.node(e.to);

      // Calculate direction vector
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Shorten line by node radius so arrow doesn't overlap
      const shortenBy = nodeRadius + 5;
      const ratio = (dist - shortenBy) / dist;

      return {
        from: e.from,
        to: e.to,
        eventType: e.eventType,
        x1: source.x,
        y1: source.y,
        x2: source.x + dx * ratio,
        y2: source.y + dy * ratio,
        color: getEventColor(e.eventType),
      };
    });

    // Deduplicate edges for rendering - keep only one edge per from/to pair
    const edgeMap = new Map<string, LayoutEdge>();
    layoutEdges.forEach((edge) => {
      const key = `${edge.from}-${edge.to}`;
      console.log("[Visualizer] Edge:", key, "eventType:", edge.eventType);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, edge);
      }
    });
    uniqueEdges = Array.from(edgeMap.values());

    // Compute state edges (always unique, different visual style)
    stateEdges = graph.stateEdges.map((e) => {
      const source = g.node(e.from);
      const target = g.node(e.to);

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const shortenBy = nodeRadius + 5;
      const ratio = (dist - shortenBy) / dist;

      return {
        from: e.from,
        to: e.to,
        eventType: e.label,
        x1: source.x,
        y1: source.y,
        x2: source.x + dx * ratio,
        y2: source.y + dy * ratio,
        color: "#6B7280",
      };
    });

    console.log(
      "[Visualizer] Dagre layout computed:",
      layoutNodes.length,
      "nodes,",
      layoutEdges.length,
      "event edges,",
      uniqueEdges.length,
      "unique,",
      stateEdges.length,
      "state edges",
    );
  }

  function handleLiveEvent(event: any, timestamp: number) {
    // Handle state updates differently
    if (event.type === "__state_update__") {
      recentEvents = [
        { eventType: `${event.source} state update`, timestamp },
        ...recentEvents.slice(0, 50),
      ];

      // Create particles on state edges FROM this service
      const matchingStateEdges = stateEdges.filter(
        (e) => e.from === event.source,
      );

      matchingStateEdges.forEach((edge) => {
        const particleId = `state-${edge.from}-${edge.to}-${timestamp}-${Math.random().toString(36).slice(2)}`;

        // Color based on which service is updating
        const serviceColors: Record<string, string> = {
          MessagesState: "#3B82F6", // Blue
          UIDisplayState: "#8B5CF6", // Purple
          CommandState: "#10B981", // Green
          InterruptState: "#F59E0B", // Orange
          VisualizerSink: "#6B7280", // Gray
        };
        const color = serviceColors[event.source] || "#9CA3AF";

        const particle: Particle = {
          id: particleId,
          from: edge.from,
          to: edge.to,
          x: edge.x1,
          y: edge.y1,
          color,
          startTime: Date.now(),
        };

        particles = [...particles, particle];

        // Animate particle
        const startTime = Date.now();
        const animationInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(elapsed / 800, 1); // Faster than events (800ms)

          const currentParticle = particles.find((p) => p.id === particleId);
          if (!currentParticle) {
            clearInterval(animationInterval);
            return;
          }

          currentParticle.x = edge.x1 + (edge.x2 - edge.x1) * progress;
          currentParticle.y = edge.y1 + (edge.y2 - edge.y1) * progress;

          particles = [...particles];

          if (progress >= 1) {
            clearInterval(animationInterval);
            particles = particles.filter((p) => p.id !== particleId);
          }
        }, 16);
      });
      return;
    }

    recentEvents = [
      { eventType: event.type, timestamp },
      ...recentEvents.slice(0, 50),
    ];

    // Find matching edges and create particles for EventBus events
    const matchingEdges = layoutEdges.filter((e) => e.eventType === event.type);

    matchingEdges.forEach((edge) => {
      const particleId = `${edge.from}-${edge.to}-${timestamp}-${Math.random().toString(36).slice(2)}`;
      const particle: Particle = {
        id: particleId,
        from: edge.from,
        to: edge.to,
        x: edge.x1,
        y: edge.y1,
        color: edge.color,
        startTime: Date.now(),
      };

      particles = [...particles, particle];

      // Animate particle with simple interval (anime.js doesn't work well with Svelte reactivity)
      const startTime = Date.now();
      const animationInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / 1000, 1);

        const currentParticle = particles.find((p) => p.id === particleId);
        if (!currentParticle) {
          clearInterval(animationInterval);
          return;
        }

        currentParticle.x = edge.x1 + (edge.x2 - edge.x1) * progress;
        currentParticle.y = edge.y1 + (edge.y2 - edge.y1) * progress;

        // Trigger reactivity
        particles = [...particles];

        if (progress >= 1) {
          clearInterval(animationInterval);
          particles = particles.filter((p) => p.id !== particleId);
        }
      }, 16); // 60fps
    });
  }

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  }
</script>

<div class="visualizer">
  <div class="graph-container">
    <svg {viewBox} class="graph-svg">
      <defs>
        <!-- Single gray arrow marker -->
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#6B7280" />
        </marker>
      </defs>

      <!-- Event edges - solid lines -->
      <g class="event-edges">
        {#each uniqueEdges as edge (edge.from + "-" + edge.to)}
          <line
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke="#4B5563"
            stroke-width="2"
            stroke-opacity="0.4"
            marker-end="url(#arrow)"
          />
        {/each}
      </g>

      <!-- State edges - dashed lines -->
      <g class="state-edges">
        {#each stateEdges as edge (edge.from + "-" + edge.to)}
          <line
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke="#6B7280"
            stroke-width="2"
            stroke-opacity="0.3"
            stroke-dasharray="5,5"
            marker-end="url(#arrow)"
          />
        {/each}
      </g>

      <!-- Nodes -->
      <g class="nodes">
        {#each layoutNodes as node (node.name)}
          <g transform="translate({node.x},{node.y})">
            <circle
              r={nodeRadius}
              fill="#1F2937"
              stroke="#4B5563"
              stroke-width="2"
            />
            <text
              text-anchor="middle"
              dy="5"
              font-size="11"
              fill="#E5E7EB"
              pointer-events="none"
            >
              {node.name}
            </text>
          </g>
        {/each}
      </g>

      <!-- Particles -->
      <g class="particles">
        {#each particles as particle (particle.id)}
          <circle
            cx={particle.x}
            cy={particle.y}
            r="6"
            fill={particle.color}
            opacity="0.9"
          />
        {/each}
      </g>
    </svg>
  </div>

  <div class="event-log">
    <h3>Recent Events</h3>
    <div class="events-list">
      {#each recentEvents as event}
        <div class="event-item">
          <span
            class="event-dot"
            style="background-color: {getEventColor(event.eventType)}"
          ></span>
          <span class="event-type">{event.eventType}</span>
          <span class="event-time">{formatTime(event.timestamp)}</span>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .visualizer {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #111827;
    color: #e5e7eb;
  }

  .graph-container {
    flex: 1;
    position: relative;
    overflow: hidden;
    padding: 20px;
  }

  .graph-svg {
    width: 100%;
    height: 100%;
  }

  .event-log {
    height: 200px;
    border-top: 1px solid #374151;
    padding: 12px;
    overflow-y: auto;
  }

  .event-log h3 {
    margin: 0 0 8px 0;
    font-size: 14px;
    font-weight: 600;
    color: #9ca3af;
  }

  .events-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .event-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-family: "Menlo", "Monaco", monospace;
  }

  .event-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .event-type {
    flex: 1;
    color: #e5e7eb;
  }

  .event-time {
    color: #6b7280;
    font-size: 11px;
  }
</style>
