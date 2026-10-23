// ── SECTION 1: Imports ─────────────────────────────────────
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import { useTranslation } from "react-i18next"
import * as d3 from 'd3'
import { apiFetchNxGraph, apiFetchPopularLabels, apiStartSemanticDedup, apiFetchSemanticDedupStatus, WorkspaceLockError, isWorkspaceLockError } from './lib/api'
import type { NxGraphResponse, NxLink, NxNode, SemanticDedupResult, SemanticDedupProgress } from './lib/api.type'
import LockErrorBanner from './components/LockErrorBanner'
import useCurrentUser from '~/hooks/useCurrentUser'

// CSS classes for LOD and hover optimization (see KnowledgeGraphViewer.css)
import './KnowledgeGraphViewer.css'

// ── SECTION 2: Constants ───────────────────────────────────

/** BFS traversal depth khi fetch subgraph */
const MAX_DEPTH = 3

/**
 * Default max nodes — user-configurable via slider.
 * Start at 200 for a smooth baseline; user can increase to 500.
 * LightRAG equivalent: graphMaxNodes default (Technique 6).
 */
const DEFAULT_MAX_NODES = 200

/** Minimum node radius (px) */
const MIN_NODE_RADIUS = 5

/** Maximum node radius (px) */
const MAX_NODE_RADIUS = 28

/** D3 force: khoảng cách link (px) */
const FORCE_LINK_DISTANCE = 90

/** D3 force: charge strength (âm = đẩy nhau ra) */
const FORCE_CHARGE_STRENGTH = -220

/**
 * Alpha decay for D3 simulation.
 * Default D3 value: 0.0228 (~300 ticks to cool).
 * Our value: 0.04 (~170 ticks) — converges ~2× faster.
 * LightRAG equivalent: ForceAtlas2 param tuning (Technique 20).
 */
const ALPHA_DECAY = 0.04

/**
 * Zoom threshold below which ALL node labels are hidden.
 * LightRAG equivalent: labelRenderedSizeThreshold: 12 (Technique 2).
 */
const LABEL_ZOOM_THRESHOLD = 1.4

/**
 * Zoom threshold below which nodes shrink to simple 3px dots.
 * LightRAG equivalent: NodePointProgram (cheapest WebGL node program).
 */
const POINT_MODE_ZOOM_THRESHOLD = 0.4

/**
 * Entity type colors — vivid Tailwind 500-level palette
 */
const ENTITY_COLORS: Readonly<Record<string, string>> = {
    person: '#3B82F6',
    organization: '#22C55E',
    location: '#F97316',
    event: '#14B8A6',
    concept: '#EF4444',
    artifact: '#8B5CF6',
    geo: '#F97316',
    category: '#D946EF',
} as const

const DEFAULT_NODE_COLOR = '#94A3B8'

// ── SECTION 3 (NEW): TypeScript Interfaces ─────────────────

/**
 * Controls for programmatic zoom — exposed from ForceGraph to parent.
 * LightRAG equivalent: ZoomControl.tsx useCamera() (Technique 18).
 */
interface ZoomControls {
    readonly zoomIn: () => void
    readonly zoomOut: () => void
    readonly resetZoom: () => void
    /** Smoothly pan the camera to center on a specific node. */
    readonly panToNode: (nodeId: string) => void
}

/**
 * Controls to stop/restart the D3 force simulation from outside ForceGraph.
 * LightRAG equivalent: LayoutsControl.tsx workerForce.start()/stop().
 */
interface SimulationControls {
    readonly stop: () => void
    readonly restart: () => void
}

// ── SECTION 3.5: Type guards & helpers ──────────────────────

/**
 * Type guard: kiểm tra một link endpoint đã được D3 resolve thành NxNode chưa.
 */
function isNxNode(value: string | NxNode): value is NxNode {
    return typeof value === 'object' && value !== null && 'id' in value
}

/**
 * Lấy x coordinate từ link endpoint.
 */
function getLinkX(endpoint: string | NxNode): number {
    if (!isNxNode(endpoint)) { return 0 }
    return endpoint.x ?? 0
}

/**
 * Lấy y coordinate từ link endpoint.
 */
function getLinkY(endpoint: string | NxNode): number {
    if (!isNxNode(endpoint)) { return 0 }
    return endpoint.y ?? 0
}

/**
 * Tính node radius dựa trên degree_centrality.
 * Dùng sqrt scaling để hub nodes không quá to.
 */
function computeNodeRadius(centrality: number): number {
    const range = MAX_NODE_RADIUS - MIN_NODE_RADIUS
    return MIN_NODE_RADIUS + range * Math.sqrt(Math.max(0, Math.min(1, centrality)))
}

/**
 * Lấy màu node theo entity type.
 * Unknown types: deterministic HSL color từ string hash.
 */
function getEntityTypeColor(entityType: string | undefined): string {
    if (!entityType) { return DEFAULT_NODE_COLOR }
    const normalized = entityType.toLowerCase()
    if (normalized in ENTITY_COLORS) { return ENTITY_COLORS[normalized] }
    let hash = 0
    for (let i = 0; i < normalized.length; i++) {
        hash = normalized.charCodeAt(i) + ((hash << 5) - hash)
        hash = hash | 0
    }
    const hue = Math.abs(hash) % 360
    return `hsl(${hue}, 68%, 55%)`
}

// ── SECTION 3.6 (NEW): Canvas Edge Drawing ─────────────────

/**
 * Draws all graph edges onto a 2D Canvas element.
 *
 * WHY CANVAS INSTEAD OF SVG LINES:
 * 500 nodes with average degree ~4 = ~1,000 edges.
 * SVG: 1,000 <line> DOM elements → browser layout tree, CSS paint.
 * Canvas: 2 ctx.stroke() calls for ALL 1,000 edges combined.
 *
 * LightRAG equivalent: WebGL GPU Rendering with 1 draw call (Technique 1).
 *
 * BATCHING STRATEGY (2 draw calls for all edges):
 * - Call 1: all dimmed/normal edges (1 path object, 1 stroke)
 * - Call 2: highlighted edges connected to hovered node (only when hovering)
 *
 * @param canvas     - The HTMLCanvasElement to draw onto
 * @param links      - All graph edges (D3 has mutated source/target to NxNode objects)
 * @param transform  - Current D3 zoom transform (translate + scale)
 * @param hoveredId  - ID of the currently hovered node, or null if none
 * @param neighbors  - Set of neighbor IDs of the hovered node (for highlight batch)
 */
function drawEdgesOnCanvas(
    canvas: HTMLCanvasElement | null,
    links: NxLink[],
    transform: d3.ZoomTransform,
    hoveredId: string | null,
    _neighbors: Set<string>,
    visibleIds: Set<string> | null = null,
): void {
    if (canvas === null) { return }
    const ctx = canvas.getContext('2d')
    if (ctx === null) { return }

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()

    // Apply the same zoom/pan transform as the SVG container group
    ctx.translate(transform.x, transform.y)
    ctx.scale(transform.k, transform.k)

    // ── Batch 1: Normal / dimmed edges ───────────────────────────
    ctx.beginPath()
    ctx.strokeStyle = hoveredId !== null
        ? 'rgba(156,163,175,0.07)'
        : 'rgba(156,163,175,0.50)'
    // Keep visual line width constant regardless of zoom level
    ctx.lineWidth = 1 / transform.k

    for (const link of links) {
        const srcId = isNxNode(link.source) ? link.source.id : link.source
        const tgtId = isNxNode(link.target) ? link.target.id : link.target
        if (visibleIds !== null && (!visibleIds.has(srcId) || !visibleIds.has(tgtId))) { continue }
        if (hoveredId !== null && (srcId === hoveredId || tgtId === hoveredId)) { continue }
        ctx.moveTo(getLinkX(link.source), getLinkY(link.source))
        ctx.lineTo(getLinkX(link.target), getLinkY(link.target))
    }
    ctx.stroke()

    // ── Batch 2: Highlighted edges (only during hover) ───────────
    // LightRAG equivalent: edge visible (not hidden=true) for focused node (Technique 9).
    if (hoveredId !== null) {
        ctx.beginPath()
        ctx.strokeStyle = 'rgba(156,163,175,0.85)'
        ctx.lineWidth = 2 / transform.k

        for (const link of links) {
            const srcId = isNxNode(link.source) ? link.source.id : link.source
            const tgtId = isNxNode(link.target) ? link.target.id : link.target
            if (visibleIds !== null && (!visibleIds.has(srcId) || !visibleIds.has(tgtId))) { continue }
            if (srcId === hoveredId || tgtId === hoveredId) {
                ctx.moveTo(getLinkX(link.source), getLinkY(link.source))
                ctx.lineTo(getLinkX(link.target), getLinkY(link.target))
            }
        }
        ctx.stroke()
    }

    ctx.restore()
}

// ── SECTION 4: LabelCheckboxPanel ─────────────────────────

interface LabelCheckboxPanelProps {
    labels: string[]
    checkedLabels: Set<string>
    onToggle: (label: string) => void
    onClearAll: () => void
    onClose: () => void
}

/**
 * Dropdown panel with a search input + checkbox per popular label.
 */
function LabelCheckboxPanel({
    labels,
    checkedLabels,
    onToggle,
    onClearAll,
    onClose,
}: LabelCheckboxPanelProps): React.JSX.Element {
    const { t } = useTranslation()
    const [searchQuery, setSearchQuery] = useState<string>('')

    const filteredLabels: string[] = searchQuery.trim()
        ? labels.filter((l: string) =>
              l.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : labels

    return (
        <div className="absolute top-10 left-0 z-30 w-56 bg-white dark:bg-[#1f232e] border border-gray-200 dark:border-[#2a2f3e] rounded-md shadow-xl">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-[#2a2f3e]">
                <span className="text-xs font-medium text-gray-600 dark:text-[#E6E6E6]">
                    {t("Filter by Label")}
                </span>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={onClearAll}
                        className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 px-1 py-0.5 rounded focus:outline-none transition-colors"
                    >
                        {t("Clear")}
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-1 py-0.5 rounded focus:outline-none transition-colors"
                        aria-label="Close filter panel"
                    >
                        ✕
                    </button>
                </div>
            </div>

            <div className="px-3 py-2 border-b border-gray-100 dark:border-[#2a2f3e]">
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setSearchQuery(e.target.value)
                    }
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Escape') { onClose() }
                    }}
                    placeholder={t("Search labels...")}
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    className="w-full h-7 px-2 text-sm rounded border border-gray-200 dark:border-[#2a2f3e] bg-gray-50 dark:bg-[#2a2f3e] text-gray-800 dark:text-[#E6E6E6] placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    aria-label="Search labels"
                />
            </div>

            <div className="overflow-y-auto max-h-64 py-1">
                {filteredLabels.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-gray-400 dark:text-[#6b7280] text-center">
                        {t("No labels found")}
                    </p>
                ) : (
                    filteredLabels.map((label: string) => (
                        <label
                            key={label}
                            className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
                                checkedLabels.has(label)
                                    ? 'bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
                                    : 'hover:bg-gray-50 dark:hover:bg-[#2a2f3e]'
                            }`}
                        >
                            <input
                                type="checkbox"
                                checked={checkedLabels.has(label)}
                                onChange={() => onToggle(label)}
                                className="w-3.5 h-3.5 accent-emerald-500 flex-shrink-0 cursor-pointer"
                            />
                            <span className="text-sm text-gray-700 dark:text-[#E6E6E6] truncate">
                                {label}
                            </span>
                        </label>
                    ))
                )}
            </div>
        </div>
    )
}

// ── SECTION 5: D3 ForceGraph Component ────────────────────

/**
 * Extended props for ForceGraph — adds performance control callbacks.
 */
interface ForceGraphProps {
    /** Graph data enriched by NetworkX */
    data: NxGraphResponse
    /** Callback when user clicks a node */
    onNodeClick: (node: NxNode) => void
    /**
     * Set of node IDs to show when label filter is active.
     * Empty Set = no filter. Non-empty = only these node IDs visible.
     */
    visibleNodeIds: Set<string>
    /**
     * Called once after zoom behavior is initialized.
     * Parent stores returned controls to wire up zoom buttons in toolbar.
     * LightRAG equivalent: ZoomControl.tsx (Technique 18).
     */
    onZoomReady?: (controls: ZoomControls) => void
    /**
     * Called when simulation starts or stops.
     * Parent uses this to show/hide the "Stabilizing..." badge.
     */
    onSimulationStateChange?: (isRunning: boolean) => void
    /**
     * Ref populated with simulation stop/restart methods.
     */
    simulationControlsRef?: React.MutableRefObject<SimulationControls | null>
    /**
     * Ref populated with the array of rendered nodes for panToNode lookup.
     */
    nodesPositionRef?: React.MutableRefObject<NxNode[]>
}

/**
 * D3 force-directed graph renderer — PERFORMANCE OPTIMIZED.
 *
 * Key changes vs original:
 * 1. Canvas 2D for edges (removes ~1,000+ SVG <line> DOM elements)
 * 2. RAF-throttled tick loop at 30fps (simulation doesn't block UI)
 * 3. Auto-stop on convergence + expose stop/restart controls
 * 4. LOD: label group CSS class toggle (1 DOM change per zoom, not 500)
 * 5. LOD: point mode at zoom < 0.4 (circles → 3px dots)
 * 6. CSS class hover (.dimmed/.highlighted — GPU compositor, not JS DOM)
 * 7. Expose zoom/simulation controls to parent via callbacks/refs
 */
function ForceGraph({
    data,
    onNodeClick,
    visibleNodeIds,
    onZoomReady,
    onSimulationStateChange,
    simulationControlsRef,
    nodesPositionRef,
}: ForceGraphProps): React.JSX.Element {
    const svgRef = useRef<SVGSVGElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const simulationRef = useRef<d3.Simulation<NxNode, NxLink> | null>(null)
    const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
    const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity)
    const hoveredNodeRef = useRef<string | null>(null)
    const hoveredNeighborsRef = useRef<Set<string>>(new Set<string>())
    const visibleNodeIdsRef = useRef<Set<string>>(visibleNodeIds)
    visibleNodeIdsRef.current = visibleNodeIds
    const rafIdRef = useRef<number | null>(null)
    const isRunningRef = useRef<boolean>(false)
    // Shared links ref — makes the current D3-mutated links array accessible
    // to Effect 2 (visibleNodeIds filter) and the ResizeObserver, both of
    // which live outside Effect 1's closure scope.
    const linksRef = useRef<NxLink[]>([])

    // ── Main Effect: Setup D3 graph ───────────────────────────────
    useEffect(() => {
        const svgEl = svgRef.current
        const canvasEl = canvasRef.current
        if (svgEl === null || canvasEl === null || data.nodes.length === 0) { return }

        // Stop any running animation from previous render
        isRunningRef.current = false
        if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current)
            rafIdRef.current = null
        }
        if (simulationRef.current !== null) {
            simulationRef.current.stop()
        }

        // ── Dimensions ───────────────────────────────────────────────
        const width = svgEl.clientWidth || 800
        const height = svgEl.clientHeight || 600

        // Set canvas physical size to match SVG container
        canvasEl.width = width
        canvasEl.height = height

        // ── Data: deep copy so D3 can mutate (adds x, y, fx, fy) ────
        const nodes: NxNode[] = data.nodes.map((n: NxNode) => ({ ...n }))
        const links: NxLink[] = data.links.map((l: NxLink) => ({ ...l }))
        // FIX #1: expose links to Effect 2 and ResizeObserver via ref
        linksRef.current = links

        // Expose current node positions for panToNode lookup
        if (nodesPositionRef !== undefined) {
            nodesPositionRef.current = nodes
        }

        // ── Build adjacency map for hover highlighting (O(1) lookup) ─
        // LightRAG equivalent: Hash Maps O(1) (Technique 16).
        const neighborMap = new Map<string, Set<string>>()
        nodes.forEach((n: NxNode) => neighborMap.set(n.id, new Set<string>()))
        links.forEach((l: NxLink) => {
            const srcId = isNxNode(l.source) ? l.source.id : l.source
            const tgtId = isNxNode(l.target) ? l.target.id : l.target
            neighborMap.get(srcId)?.add(tgtId)
            neighborMap.get(tgtId)?.add(srcId)
        })

        // ── Clear SVG ────────────────────────────────────────────────
        d3.select(svgEl).selectAll('*').remove()

        const svg = d3.select(svgEl)
            .attr('width', '100%')
            .attr('height', '100%')

        // Container group — receives zoom transform
        const g = svg.append('g').attr('class', 'graph-root')

        // ── Zoom behavior ────────────────────────────────────────────
        // Track point-mode state to avoid redundant selectAll on every zoom event
        let wasPointMode = false

        const zoom = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.05, 8])
            .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
                const { transform } = event
                transformRef.current = transform
                g.attr('transform', String(transform))
                const k = transform.k

                // ── LOD 1: Label group CSS class toggle ──────────────
                // ONE .classed() call on ONE element — CSS hides all 500 labels.
                // LightRAG equivalent: labelRenderedSizeThreshold: 12 (Technique 2).
                g.classed('labels-hidden', k < LABEL_ZOOM_THRESHOLD)

                // ── LOD 2: Point mode — only fires when crossing threshold ──
                // Avoids selectAll(500) on every zoom event.
                // LightRAG equivalent: NodePointProgram (Technique 1).
                const isPointMode = k < POINT_MODE_ZOOM_THRESHOLD
                if (isPointMode !== wasPointMode) {
                    wasPointMode = isPointMode
                    if (isPointMode) {
                        nodeElements.selectAll<SVGCircleElement, NxNode>('.node-circle')
                            .attr('r', 3)
                            .attr('stroke-width', 0)
                    } else {
                        nodeElements.selectAll<SVGCircleElement, NxNode>('.node-circle')
                            .attr('r', (d: NxNode) => computeNodeRadius(d.degree_centrality))
                            .attr('stroke-width', 1.5)
                    }
                }

                // Redraw canvas edges with new transform
                drawEdgesOnCanvas(
                    canvasEl, links, transform,
                    hoveredNodeRef.current, hoveredNeighborsRef.current,
                    visibleNodeIdsRef.current.size > 0 ? visibleNodeIdsRef.current : null,
                )
            })

        zoomBehaviorRef.current = zoom
        svg.call(zoom)

        // ── Nodes group ───────────────────────────────────────────────
        const nodeGroup = g.append('g').attr('class', 'nodes')

        const nodeElements = nodeGroup
            .selectAll<SVGGElement, NxNode>('g.node')
            .data(nodes, (d: NxNode) => d.id)
            .join('g')
            .attr('class', 'node')
            .style('cursor', 'pointer')

        nodeElements
            .append('circle')
            .attr('class', 'node-circle')
            .attr('r', (d: NxNode) => computeNodeRadius(d.degree_centrality))
            .attr('fill', (d: NxNode) => getEntityTypeColor(d.entity_type))
            .attr('stroke', '#fff')
            .attr('stroke-width', 1.5)

        // Hub nodes get .hub-label so they stay visible when labels-hidden is active
        nodeElements
            .append('text')
            .attr('class', (d: NxNode) =>
                d.degree > 3 ? 'node-label hub-label' : 'node-label'
            )
            .attr('dy', (d: NxNode) => -(computeNodeRadius(d.degree_centrality) + 4))
            .attr('text-anchor', 'middle')
            .attr('pointer-events', 'none')
            .text((d: NxNode) => d.label)

        nodeElements
            .append('title')
            .text((d: NxNode) =>
                `${d.label}\nType: ${d.entity_type ?? 'unknown'}\nDegree: ${d.degree}\nCommunity: ${d.community ?? '-'}`
            )

        // ── Drag behavior ────────────────────────────────────────────
        const drag = d3.drag<SVGGElement, NxNode>()
            .on('start', (event: d3.D3DragEvent<SVGGElement, NxNode, NxNode>, d: NxNode) => {
                if (!event.active && simulationRef.current !== null) {
                    simulationRef.current.alpha(0.1)
                    if (!isRunningRef.current) { startSimulation() }
                }
                d.fx = d.x
                d.fy = d.y
            })
            .on('drag', (event: d3.D3DragEvent<SVGGElement, NxNode, NxNode>, d: NxNode) => {
                d.fx = event.x
                d.fy = event.y
            })
            .on('end', (
                _event: d3.D3DragEvent<SVGGElement, NxNode, NxNode>,
                _d: NxNode,
            ) => {
                // Node stays pinned after drag
            })

        nodeElements.call(drag)

        // ── Hover: CSS class approach ────────────────────────────────
        // BEFORE: nodeElements.style('opacity', fn) — 500 inline style mutations.
        // AFTER:  .classed('dimmed'/'highlighted') — CSS GPU compositor handles opacity.
        // LightRAG equivalent: nodeReducer dim non-neighbors (Technique 8).
        nodeElements
            .on('mouseenter', (_event: MouseEvent, d: NxNode) => {
                const neighbors = neighborMap.get(d.id) ?? new Set<string>()
                hoveredNodeRef.current = d.id
                hoveredNeighborsRef.current = neighbors

                nodeElements
                    .classed('dimmed', (n: NxNode) => n.id !== d.id && !neighbors.has(n.id))
                    .classed('highlighted', (n: NxNode) => n.id === d.id || neighbors.has(n.id))

                drawEdgesOnCanvas(canvasEl, links, transformRef.current, d.id, neighbors,
                    visibleNodeIdsRef.current.size > 0 ? visibleNodeIdsRef.current : null,
                )
            })
            .on('mouseleave', () => {
                hoveredNodeRef.current = null
                hoveredNeighborsRef.current = new Set<string>()

                const currentFilter = visibleNodeIdsRef.current
                const activeFilter = currentFilter.size > 0 ? currentFilter : null

                nodeElements
                    .classed('highlighted', false)
                    .classed('dimmed', false)
                    .classed('label-filtered', (n: NxNode) =>
                        activeFilter !== null && !activeFilter.has(n.id)
                    )

                drawEdgesOnCanvas(
                    canvasEl, links, transformRef.current,
                    null, new Set<string>(), activeFilter,
                )
            })

        nodeElements.on('click', (_event: MouseEvent, d: NxNode) => {
            onNodeClick(d)
        })

        // ── D3 Force Simulation ──────────────────────────────────────
        // .stop() — simulation does NOT auto-run; RAF loop calls .tick() manually.
        // LightRAG equivalent: Web Workers approach — UI thread never blocked (Technique 4).
        const simulation = d3.forceSimulation<NxNode, NxLink>(nodes)
            .force('link', d3.forceLink<NxNode, NxLink>(links)
                .id((d: NxNode) => d.id)
                .distance(FORCE_LINK_DISTANCE)
                .strength(0.5)
            )
            .force('charge', d3.forceManyBody<NxNode>().strength(FORCE_CHARGE_STRENGTH))
            .force('center', d3.forceCenter<NxNode>(width / 2, height / 2))
            .force('collision', d3.forceCollide<NxNode>()
                .radius((d: NxNode) => computeNodeRadius(d.degree_centrality) + 3)
            )
            .force('orphan-x',
                d3.forceX<NxNode>(width / 2)
                    .strength((d: NxNode) => d.degree === 0 ? 0.3 : 0)
            )
            .force('orphan-y',
                d3.forceY<NxNode>(height / 2)
                    .strength((d: NxNode) => d.degree === 0 ? 0.3 : 0)
            )
            .alphaDecay(ALPHA_DECAY)
            .velocityDecay(0.45)
            .stop()

        simulationRef.current = simulation

        // ── RAF Tick Loop ────────────────────────────────────────────
        // BEFORE: simulation.on('tick', ...) at 60fps, blocking main thread.
        // AFTER:  RAF loop with 30fps DOM cap + 2 physics ticks per frame.
        // LightRAG equivalent: Web Worker + 200ms interval update (Techniques 4, 5).
        let lastDrawTime = 0

        function tick(): void {
            if (!isRunningRef.current) { return }

            // 2 physics iterations per frame — faster convergence without UI blocking
            simulation.tick()
            simulation.tick()

            const now = performance.now()
            // DOM update cap ~30fps — gives browser event queue space for user input
            if (now - lastDrawTime >= 33) {
                lastDrawTime = now

                nodeElements.attr('transform', (d: NxNode) =>
                    `translate(${d.x ?? 0},${d.y ?? 0})`
                )

                drawEdgesOnCanvas(
                    canvasEl, links, transformRef.current,
                    hoveredNodeRef.current, hoveredNeighborsRef.current,
                    visibleNodeIdsRef.current.size > 0 ? visibleNodeIdsRef.current : null,
                )
            }

            if (simulation.alpha() > simulation.alphaMin()) {
                rafIdRef.current = requestAnimationFrame(tick)
            } else {
                // Simulation has stabilized — stop loop
                isRunningRef.current = false
                rafIdRef.current = null
                onSimulationStateChange?.(false)

                // Final render pass
                nodeElements.attr('transform', (d: NxNode) =>
                    `translate(${d.x ?? 0},${d.y ?? 0})`
                )
                drawEdgesOnCanvas(
                    canvasEl, links, transformRef.current, null, new Set<string>(),
                    visibleNodeIdsRef.current.size > 0 ? visibleNodeIdsRef.current : null,
                )
            }
        }

        function startSimulation(): void {
            isRunningRef.current = true
            onSimulationStateChange?.(true)
            rafIdRef.current = requestAnimationFrame(tick)
        }

        startSimulation()

        // ── Expose Zoom Controls ─────────────────────────────────────
        // LightRAG equivalent: ZoomControl.tsx useCamera() (Technique 18).
        const svgSel = d3.select(svgEl)

        onZoomReady?.({
            zoomIn: () => {
                svgSel.transition().duration(300)
                    .call(zoom.scaleBy, 1.5)
            },
            zoomOut: () => {
                svgSel.transition().duration(300)
                    .call(zoom.scaleBy, 0.67)
            },
            resetZoom: () => {
                svgSel.transition().duration(800)
                    .call(
                        zoom.transform,
                        d3.zoomIdentity.translate(width / 2, height / 2).scale(0.7),
                    )
            },
            panToNode: (nodeId: string) => {
                const target = (nodesPositionRef?.current ?? nodes)
                    .find((n: NxNode) => n.id === nodeId)
                if (target === undefined || target.x === undefined || target.y === undefined) {
                    return
                }
                svgSel.transition().duration(500)
                    .call(
                        zoom.transform,
                        d3.zoomIdentity
                            .translate(width / 2, height / 2)
                            .scale(1.5)
                            .translate(-target.x, -target.y),
                    )
            },
        })

        // ── Expose Simulation Controls ───────────────────────────────
        if (simulationControlsRef !== undefined && simulationControlsRef !== null) {
            simulationControlsRef.current = {
                stop: () => {
                    isRunningRef.current = false
                    if (rafIdRef.current !== null) {
                        cancelAnimationFrame(rafIdRef.current)
                        rafIdRef.current = null
                    }
                    onSimulationStateChange?.(false)
                },
                restart: () => {
                    simulation.alpha(0.3)
                    startSimulation()
                },
            }
        }

        // ── FIX #2: ResizeObserver — keep canvas pixel size in sync with SVG ──
        // Canvas API does NOT respond to CSS dimensions; must be resized explicitly.
        const resizeObserver = new ResizeObserver(() => {
            // Re-read from ref inside callback: TypeScript does not propagate the
            // outer null-narrowing of `canvasEl` across async closure boundaries.
            const canvas = canvasRef.current
            if (canvas === null) { return }
            const w = svgEl.clientWidth || 800
            const h = svgEl.clientHeight || 600
            canvas.width = w
            canvas.height = h
            drawEdgesOnCanvas(
                canvas, linksRef.current, transformRef.current,
                hoveredNodeRef.current, hoveredNeighborsRef.current,
                visibleNodeIdsRef.current.size > 0 ? visibleNodeIdsRef.current : null,
            )
        })
        resizeObserver.observe(svgEl)

        // ── Cleanup ──────────────────────────────────────────────────
        return (): void => {
            resizeObserver.disconnect()
            isRunningRef.current = false
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current)
                rafIdRef.current = null
            }
            simulation.stop()
            // FIX #4: null out stale simulation controls so the next effect's
            // controls are not overwritten by a call to the old closure.
            if (simulationControlsRef !== undefined && simulationControlsRef !== null) {
                simulationControlsRef.current = null
            }
        }
        // onZoomReady, onSimulationStateChange, simulationControlsRef, nodesPositionRef
        // are stable callbacks/refs — intentionally omitted to avoid false re-runs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, onNodeClick])

    // ── Effect 2: Opacity filter when visibleNodeIds changes ─────
    useEffect(() => {
        const svgEl = svgRef.current
        const canvasEl = canvasRef.current
        if (svgEl === null || canvasEl === null) { return }

        const activeFilter = visibleNodeIds.size > 0 ? visibleNodeIds : null

        const nodeSelection = d3.select(svgEl).selectAll<SVGGElement, NxNode>('g.node')

        nodeSelection.style('pointer-events', (d: NxNode) => {
            if (activeFilter === null) { return 'all' }
            return activeFilter.has(d.id) ? 'all' : 'none'
        })

        nodeSelection.classed('label-filtered', (d: NxNode) =>
            activeFilter !== null && !activeFilter.has(d.id)
        )

        // FIX #1: use linksRef.current (not []) so canvas edges remain visible
        // after label filter is applied. The actual D3-mutated links array lives
        // in Effect 1's closure; linksRef bridges the scope gap.
        drawEdgesOnCanvas(
            canvasEl, linksRef.current, transformRef.current, null, new Set<string>(), activeFilter,
        )
    }, [visibleNodeIds])

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <canvas
                ref={canvasRef}
                style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                }}
            />
            <svg
                ref={svgRef}
                className="w-full h-full"
                style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'transparent',
                }}
            />
        </div>
    )
}

// ── SECTION 6: NodeInfoPanel ───────────────────────────────

interface NodeInfoPanelProps {
    node: NxNode | null
    onClose: () => void
}

function NodeInfoPanel({ node, onClose }: NodeInfoPanelProps): React.JSX.Element | null {
    const { t } = useTranslation()
    if (!node) { return null }

    return (
        <div className="absolute top-3 right-3 z-20 w-64 p-3 bg-white/95 dark:bg-[#1f232e]/95 rounded-lg border border-gray-200 dark:border-[#2a2f3e] shadow-lg backdrop-blur-sm text-sm">
            <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-gray-900 dark:text-[#E6E6E6] break-all pr-2">
                    {node.label}
                </h3>
                <button
                    type="button"
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 focus:outline-none flex-shrink-0"
                    aria-label="Close node info"
                >
                    ✕
                </button>
            </div>

            {node.entity_type && (
                <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-[#2a2f3e] text-gray-600 dark:text-[#E6E6E6] mb-2 capitalize">
                    {node.entity_type.toLowerCase()}
                </span>
            )}

            <div className="grid grid-cols-2 gap-1 mb-2 text-center">
                <div className="bg-gray-50 dark:bg-[#2a2f3e] rounded p-1">
                    <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                        {node.degree}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-[#8a8f9e]">{t("Links")}</div>
                </div>
                <div className="bg-gray-50 dark:bg-[#2a2f3e] rounded p-1">
                    <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                        {(node.degree_centrality * 100).toFixed(0)}%
                    </div>
                    <div className="text-xs text-gray-500 dark:text-[#8a8f9e]">{t("Central")}</div>
                </div>
            </div>

            {node.description && (
                <div className="overflow-y-auto max-h-48 mt-1">
                    <p className="text-xs text-gray-500 dark:text-[#8a8f9e] leading-relaxed">
                        {node.description}
                    </p>
                </div>
            )}
        </div>
    )
}

// ── SECTION 7: Legend Component ────────────────────────────

function GraphLegend({ nodes }: { nodes: NxNode[] }): React.JSX.Element {
    const { t } = useTranslation()
    const uniqueTypes: string[] = [
        ...new Set(nodes.map((n: NxNode) => n.entity_type).filter(Boolean)),
    ]

    return (
        <div className="absolute bottom-3 left-3 z-10 p-2 bg-white/90 dark:bg-[#1f232e]/90 rounded-md border border-gray-200 dark:border-[#2a2f3e] text-xs backdrop-blur-sm">
            <div className="font-medium text-gray-600 dark:text-[#E6E6E6] mb-1.5">
                {t("Entity Types")}
            </div>
            {uniqueTypes.map((type: string) => (
                <div key={type} className="flex items-center gap-1.5 mt-0.5">
                    <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: getEntityTypeColor(type) }}
                    />
                    <span className="text-gray-500 dark:text-[#8a8f9e] capitalize">{type.toLowerCase()}</span>
                </div>
            ))}
        </div>
    )
}

// ── SECTION 8: Main Component ──────────────────────────────

/**
 * Interactive knowledge graph viewer — Main exported component.
 *
 * New features vs original:
 * - Max nodes slider: user controls performance vs detail tradeoff (50–500)
 * - Edge weight filter slider: hide weak edges to reduce visual clutter
 * - Zoom in/out/reset buttons with smooth animation
 * - Simulation status badge + Stop / Restart layout buttons
 * - Node search with MiniSearch (fuzzy, client-side, debounced 150ms)
 * - Pan-to-node when search result selected
 */
interface KnowledgeGraphViewerProps {
  workspaceId: string;
}

export default function KnowledgeGraphViewer({ workspaceId }: KnowledgeGraphViewerProps): React.JSX.Element {
    const { t } = useTranslation()
    const currentUser = useCurrentUser({ rejectOnEmpty: false })
    const isAdmin = currentUser?.isAdmin ?? false
    // ── State ──────────────────────────────────────────────────────
    const [queryLabel] = useState<string>('*')
    const [graphData, setGraphData] = useState<NxGraphResponse | null>(null)
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [error, setError] = useState<string | null>(null)
    const [lockError, setLockError] = useState<WorkspaceLockError | null>(null)
    const [popularLabels, setPopularLabels] = useState<string[]>([])
    const [fetchTrigger, setFetchTrigger] = useState<number>(0)
    const [selectedNode, setSelectedNode] = useState<NxNode | null>(null)
    const [checkedLabels, setCheckedLabels] = useState<Set<string>>(new Set<string>())
    const [isLabelPanelOpen, setIsLabelPanelOpen] = useState<boolean>(false)

    // Performance control state
    const [maxNodes, setMaxNodes] = useState<number>(DEFAULT_MAX_NODES)
    const [isSimulating, setIsSimulating] = useState<boolean>(false)
    const [zoomControls, setZoomControls] = useState<ZoomControls | null>(null)

    // Semantic Dedup state
    const [isDedupDialogOpen, setIsDedupDialogOpen] = useState<boolean>(false)
    const [dedupThreshold, setDedupThreshold] = useState<number>(0.9)
    const [dedupApplyMerge, setDedupApplyMerge] = useState<boolean>(false)
    const [dedupStatus, setDedupStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
    const [dedupResult, setDedupResult] = useState<SemanticDedupResult | null>(null)
    const [dedupError, setDedupError] = useState<string | null>(null)
    const [dedupProgress, setDedupProgress] = useState<SemanticDedupProgress | null>(null)

    // ── Refs ───────────────────────────────────────────────────────
    const isMounted = useRef<boolean>(true)
    const labelPanelRef = useRef<HTMLDivElement>(null)
    const simControlsRef = useRef<SimulationControls | null>(null)

    // ── Lifecycle ──────────────────────────────────────────────────
    useEffect(() => {
        isMounted.current = true
        return (): void => {
            isMounted.current = false
        }
    }, [])

    useEffect(() => {
        apiFetchPopularLabels(50, workspaceId)
            .then((labels: string[]) => {
                if (isMounted.current) { setPopularLabels(labels) }
            })
            .catch(() => {
                // Popular labels are optional — silently ignore
            })
    }, [workspaceId])

    useEffect(() => {
        const handleOutside = (e: MouseEvent): void => {
            if (
                labelPanelRef.current !== null &&
                !labelPanelRef.current.contains(e.target as Node)
            ) {
                setIsLabelPanelOpen(false)
            }
        }
        if (isLabelPanelOpen) {
            document.addEventListener('mousedown', handleOutside)
        }
        return (): void => {
            document.removeEventListener('mousedown', handleOutside)
        }
    }, [isLabelPanelOpen])

    // Fetch graph when queryLabel, maxNodes, or fetchTrigger changes
    useEffect(() => {
        setIsLoading(true)
        setError(null)
        setLockError(null)
        setSelectedNode(null)
        setCheckedLabels(new Set<string>())
        setIsLabelPanelOpen(false)

        apiFetchNxGraph(queryLabel, MAX_DEPTH, maxNodes, workspaceId)
            .then((data: NxGraphResponse) => {
                if (isMounted.current) { setGraphData(data) }
            })
            .catch((err: unknown) => {
                if (isMounted.current) {
                    if (isWorkspaceLockError(err)) {
                        setLockError(err instanceof WorkspaceLockError ? err : new WorkspaceLockError((err as Error).message, (err as WorkspaceLockError).detail ?? {}))
                    } else {
                        const message = err instanceof Error
                            ? err.message
                            : 'Failed to fetch graph data'
                        setError(message)
                    }
                }
            })
            .finally(() => {
                if (isMounted.current) { setIsLoading(false) }
            })
    }, [queryLabel, maxNodes, fetchTrigger, workspaceId])

    // ── Event Handlers ─────────────────────────────────────────────
    const handleShowAll = useCallback((): void => {
        setCheckedLabels(new Set<string>())
        setFetchTrigger((n: number) => n + 1)
    }, [])

    const handleLabelToggle = useCallback((label: string): void => {
        setCheckedLabels((prev: Set<string>) => {
            const next = new Set<string>(prev)
            if (next.has(label)) { next.delete(label) } else { next.add(label) }
            return next
        })
    }, [])

    const handleClearLabels = useCallback((): void => {
        setCheckedLabels(new Set<string>())
        setIsLabelPanelOpen(false)
    }, [])

    const handleToggleLabelPanel = useCallback((): void => {
        setIsLabelPanelOpen((prev: boolean) => !prev)
    }, [])

    const handleRetry = useCallback((): void => {
        setFetchTrigger((n: number) => n + 1)
    }, [])

    const handleNodeClick = useCallback((node: NxNode): void => {
        setSelectedNode(node)
    }, [])

    const handleClosePanel = useCallback((): void => {
        setSelectedNode(null)
    }, [])

    const handleZoomReady = useCallback((controls: ZoomControls): void => {
        setZoomControls(controls)
    }, [])

    const handleSimulationStateChange = useCallback((running: boolean): void => {
        setIsSimulating(running)
    }, [])

    // ── Semantic Dedup Handlers ───────────────────────────────────
    const handleDedupSubmit = useCallback(async (): Promise<void> => {
        try {
            setDedupStatus('running')
            setDedupResult(null)
            setDedupError(null)
            setDedupProgress(null)
            const resp = await apiStartSemanticDedup(dedupThreshold, dedupApplyMerge, workspaceId)
            if (resp.status === 'busy') {
                setDedupStatus('error')
                setDedupError(resp.message)
            }
        } catch (err: unknown) {
            setDedupStatus('error')
            setDedupError(err instanceof Error ? err.message : 'Unknown error')
        }
    }, [dedupThreshold, dedupApplyMerge])

    // Restore dedup state on mount — check if backend still has a running task
    useEffect(() => {
        let cancelled = false
        const checkRunningDedup = async (): Promise<void> => {
            try {
                const status = await apiFetchSemanticDedupStatus(workspaceId)
                if (cancelled) { return }
                if (status.running) {
                    setDedupStatus('running')
                    setIsDedupDialogOpen(true)
                    if (status.progress) {
                        setDedupProgress(status.progress)
                    }
                } else if (status.finished && status.result) {
                    setDedupStatus('done')
                    setDedupResult(status.result)
                    setIsDedupDialogOpen(true)
                }
            } catch {
                // Backend unreachable — stay idle
            }
        }
        void checkRunningDedup()
        return () => { cancelled = true }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Poll dedup status while running
    useEffect(() => {
        if (dedupStatus !== 'running') { return; }
        const interval = setInterval(async () => {
            try {
                const status = await apiFetchSemanticDedupStatus(workspaceId)
                if (status.progress) {
                    setDedupProgress(status.progress)
                }
                if (status.finished) {
                    setDedupResult(status.result)
                    setDedupStatus('done')
                    setDedupProgress(null)
                    clearInterval(interval)
                } else if (status.error) {
                    setDedupError(status.error)
                    setDedupStatus('error')
                    setDedupProgress(null)
                    clearInterval(interval)
                }
            } catch {
                // Network error — keep polling
            }
        }, 2000)
        return () => clearInterval(interval)
    }, [dedupStatus])

    const handleDedupClose = useCallback((): void => {
        setIsDedupDialogOpen(false)
        // If still running, keep polling in background — don't reset state
        if (dedupStatus !== 'running') {
            setDedupStatus('idle')
            setDedupResult(null)
            setDedupError(null)
            setDedupProgress(null)
            setDedupApplyMerge(false)
        }
    }, [dedupStatus])

    const handleDedupRefreshGraph = useCallback((): void => {
        handleDedupClose()
        setFetchTrigger((n: number) => n + 1)
    }, [handleDedupClose])

    // ── Derived State ──────────────────────────────────────────────
    const isEmpty: boolean = !graphData || graphData.nodes.length === 0
    const showGraph: boolean = !isEmpty && !isLoading && error === null && lockError === null
    const isFilterActive: boolean = checkedLabels.size > 0

    const visibleNodeIds: Set<string> = useMemo((): Set<string> => {
        if (!isFilterActive || graphData === null) { return new Set<string>() }

        const visible = new Set<string>()

        graphData.nodes.forEach((node: NxNode) => {
            if (checkedLabels.has(node.label) || checkedLabels.has(node.id)) {
                visible.add(node.id)
                graphData.links.forEach((link: NxLink) => {
                    const srcId = isNxNode(link.source) ? link.source.id : link.source
                    const tgtId = isNxNode(link.target) ? link.target.id : link.target
                    if (srcId === node.id) { visible.add(tgtId) }
                    if (tgtId === node.id) { visible.add(srcId) }
                })
            }
        })

        return visible
    }, [checkedLabels, isFilterActive, graphData])

    // ── Render ─────────────────────────────────────────────────────
    return (
        <div className="relative w-full" style={{ height: 'calc(100vh - 120px)' }}>
            <div className="absolute inset-0 bg-gray-50 dark:bg-[#111319] rounded-lg overflow-hidden border border-gray-200 dark:border-[#2a2f3e]">

                {/* ── TOOLBAR ──────────────────────────────────────────────── */}
                <div className="absolute top-3 left-3 z-10 flex items-center gap-2 flex-wrap">

                    {/* Show All */}
                    <button
                        type="button"
                        onClick={handleShowAll}
                        className="h-8 px-3 text-sm font-medium rounded-md border border-gray-200 dark:border-[#2a2f3e] bg-white dark:bg-[#1f232e] text-gray-600 dark:text-[#E6E6E6] hover:bg-gray-50 dark:hover:bg-[#2a2f3e] focus:outline-none focus:ring-2 focus:ring-emerald-400 transition-colors cursor-pointer"
                    >
                        {t("Show All")}
                    </button>

                    {/* Label filter */}
                    {popularLabels.length > 0 && (
                        <div className="relative" ref={labelPanelRef}>
                            <button
                                type="button"
                                onClick={handleToggleLabelPanel}
                                className={`h-8 px-3 text-sm font-medium rounded-md border focus:outline-none focus:ring-2 focus:ring-emerald-400 transition-colors cursor-pointer ${
                                    isFilterActive
                                        ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                                        : 'border-gray-200 dark:border-[#2a2f3e] bg-white dark:bg-[#1f232e] text-gray-600 dark:text-[#E6E6E6] hover:bg-gray-50 dark:hover:bg-[#2a2f3e]'
                                }`}
                                aria-label="Toggle label filter panel"
                                aria-expanded={isLabelPanelOpen}
                            >
                                {isFilterActive
                                    ? t("Labels ({{count}}) ▾", { count: checkedLabels.size })
                                    : t("Filter Labels ▾")
                                }
                            </button>
                            {isLabelPanelOpen && (
                                <LabelCheckboxPanel
                                    labels={popularLabels}
                                    checkedLabels={checkedLabels}
                                    onToggle={handleLabelToggle}
                                    onClearAll={handleClearLabels}
                                    onClose={() => setIsLabelPanelOpen(false)}
                                />
                            )}
                        </div>
                    )}

                    {/* Max nodes select */}
                    <div className="flex items-center gap-1.5 px-2 h-8 bg-white dark:bg-[#1f232e] border border-gray-200 dark:border-[#2a2f3e] rounded-md">
                        <span className="text-xs text-gray-500 dark:text-[#8a8f9e] whitespace-nowrap">
                            {t("Nodes:")}
                        </span>
                        <select
                            value={maxNodes}
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                                setMaxNodes(Number(e.target.value))
                            }
                            className="text-xs font-medium text-gray-700 dark:text-[#E6E6E6] bg-transparent border-none outline-none cursor-pointer"
                            aria-label="Max nodes"
                        >
                            <option value={200}>200</option>
                            <option value={500}>500</option>
                        </select>
                    </div>

                    {/* Semantic Dedup — Admin only */}
                    {isAdmin && (
                        <button
                            type="button"
                            onClick={() => setIsDedupDialogOpen(true)}
                            className={`h-8 px-3 text-sm font-medium rounded-md border transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-400 ${
                                dedupStatus === 'running'
                                    ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 animate-pulse'
                                    : 'border-gray-200 dark:border-[#2a2f3e] bg-white dark:bg-[#1f232e] text-gray-600 dark:text-[#E6E6E6] hover:bg-gray-50 dark:hover:bg-[#2a2f3e]'
                            }`}
                        >
                            {dedupStatus === 'running'
                                ? t("Dedup Running...")
                                : t("Semantic Dedup")
                            }
                        </button>
                    )}

                    {/* Simulation status + Stop */}
                    {showGraph && isSimulating && (
                        <div className="flex items-center gap-1.5 h-8 px-2 text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 rounded-md border border-amber-200 dark:border-amber-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                            <span>{t("Stabilizing...")}</span>
                            <button
                                type="button"
                                onClick={() => simControlsRef.current?.stop()}
                                className="ml-0.5 font-medium hover:text-amber-900 dark:hover:text-amber-100 focus:outline-none"
                                aria-label="Stop layout simulation"
                            >
                                {t("Stop")}
                            </button>
                        </div>
                    )}

                    {/* ── ACTIVE FILTER BADGE — inline in toolbar, pushed right ── */}
                    {isFilterActive && showGraph && (
                        <div className="ml-auto flex items-center gap-1.5 px-2 py-1 text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 rounded-md border border-emerald-300 dark:border-emerald-700">
                            <span>
                                {t("Filtering: {{labelCount}} labels · {{nodeCount}} nodes visible", { labelCount: checkedLabels.size, nodeCount: visibleNodeIds.size })}
                            </span>
                            <button
                                type="button"
                                onClick={handleClearLabels}
                                className="ml-1 text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200 focus:outline-none"
                                aria-label="Clear label filter"
                            >
                                ✕
                            </button>
                        </div>
                    )}

                </div>

                {/* ── D3 FORCE GRAPH ───────────────────────────────────────── */}
                {showGraph && graphData !== null && (
                    <ForceGraph
                        data={graphData}
                        onNodeClick={handleNodeClick}
                        visibleNodeIds={visibleNodeIds}
                        onZoomReady={handleZoomReady}
                        onSimulationStateChange={handleSimulationStateChange}
                        simulationControlsRef={simControlsRef}
                    />
                )}

                {/* ── NODE INFO PANEL ──────────────────────────────────────── */}
                <NodeInfoPanel node={selectedNode} onClose={handleClosePanel} />

                {/* ── ZOOM CONTROLS (bottom-right) ─────────────────────────────
                    LightRAG equivalent: ZoomControl.tsx (Technique 18). */}
                {showGraph && zoomControls !== null && (
                    <div className="absolute bottom-12 right-3 z-10 flex flex-col gap-1">
                        <button
                            type="button"
                            onClick={zoomControls.zoomIn}
                            className="w-8 h-8 flex items-center justify-center rounded-md bg-white dark:bg-[#1f232e] border border-gray-200 dark:border-[#2a2f3e] text-gray-600 dark:text-[#E6E6E6] hover:bg-gray-50 dark:hover:bg-[#2a2f3e] text-base font-medium focus:outline-none focus:ring-2 focus:ring-emerald-400 transition-colors"
                            aria-label="Zoom in"
                            title="Zoom in"
                        >
                            +
                        </button>
                        <button
                            type="button"
                            onClick={zoomControls.zoomOut}
                            className="w-8 h-8 flex items-center justify-center rounded-md bg-white dark:bg-[#1f232e] border border-gray-200 dark:border-[#2a2f3e] text-gray-600 dark:text-[#E6E6E6] hover:bg-gray-50 dark:hover:bg-[#2a2f3e] text-base font-medium focus:outline-none focus:ring-2 focus:ring-emerald-400 transition-colors"
                            aria-label="Zoom out"
                            title="Zoom out"
                        >
                            −
                        </button>
                        <button
                            type="button"
                            onClick={zoomControls.resetZoom}
                            className="w-8 h-8 flex items-center justify-center rounded-md bg-white dark:bg-[#1f232e] border border-gray-200 dark:border-[#2a2f3e] text-gray-600 dark:text-[#E6E6E6] hover:bg-gray-50 dark:hover:bg-[#2a2f3e] text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-400 transition-colors"
                            aria-label="Reset zoom to overview"
                            title="Reset zoom"
                        >
                            ⊡
                        </button>
                    </div>
                )}

                {/* ── LOADING OVERLAY ──────────────────────────────────────── */}
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 dark:bg-[#111319]/80">
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                            <span className="text-sm text-gray-500 dark:text-[#8a8f9e]">
                                {t("Loading knowledge graph...")}
                            </span>
                        </div>
                    </div>
                )}

                {/* ── EMPTY STATE ──────────────────────────────────────────── */}
                {isEmpty && !isLoading && error === null && lockError === null && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center">
                            <div className="text-4xl mb-3">🕸️</div>
                            <p className="text-gray-500 dark:text-[#8a8f9e] text-sm font-medium">
                                {t("No graph data")}
                            </p>
                            <p className="text-gray-400 dark:text-[#6b7280] text-xs mt-1">
                                {queryLabel !== '*'
                                    ? t("No entities found for \"{{query}}\"", { query: queryLabel })
                                    : t("Upload and process documents to build the knowledge graph")
                                }
                            </p>
                        </div>
                    </div>
                )}

                {/* ── LOCK ERROR STATE ─────────────────────────────────────── */}
                {lockError !== null && !isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="max-w-sm w-full px-4">
                            <LockErrorBanner error={lockError} onRetry={handleRetry} />
                        </div>
                    </div>
                )}

                {/* ── ERROR STATE ───────────────────────────────────────────── */}
                {error !== null && !isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center max-w-sm px-4">
                            <div className="text-4xl mb-3">⚠️</div>
                            <p className="text-red-500 dark:text-red-400 text-sm font-medium">
                                {t("Failed to load graph")}
                            </p>
                            <p className="text-gray-400 dark:text-[#6b7280] text-xs mt-1 font-mono break-all">
                                {error}
                            </p>
                            <button
                                type="button"
                                onClick={handleRetry}
                                className="mt-3 px-3 py-1.5 text-xs font-medium rounded-md bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-400"
                            >
                                {t("Retry")}
                            </button>
                        </div>
                    </div>
                )}

                {/* ── LEGEND ───────────────────────────────────────────────── */}
                {showGraph && graphData !== null && (
                    <GraphLegend nodes={graphData.nodes} />
                )}

                {/* ── STATS BADGE (bottom-right) ────────────────────────────── */}
                {showGraph && graphData !== null && (
                    <div className="absolute bottom-3 right-3 z-10 px-2 py-1 text-xs bg-white/90 dark:bg-[#1f232e]/90 text-gray-500 dark:text-[#8a8f9e] rounded-md border border-gray-200 dark:border-[#2a2f3e] backdrop-blur-sm">
                        {t("{{nodes}} nodes · {{edges}} edges", { nodes: graphData.nodes.length, edges: graphData.links.length })}
                        {graphData.is_truncated === true && (
                            <span className="ml-1 text-amber-500">{t("(truncated)")}</span>
                        )}
                    </div>
                )}

            </div>

            {/* ── SEMANTIC DEDUP DIALOG ────────────────────────────────── */}
            {isDedupDialogOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="w-full max-w-lg max-h-[80vh] overflow-y-auto bg-white dark:bg-[#1f232e] rounded-xl shadow-2xl border border-gray-200 dark:border-[#2a2f3e] p-6">

                        {/* Header */}
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-[#E6E6E6] mb-4">
                            {t("Semantic Dedup")}
                        </h2>

                        {/* Form — only show when idle or error (not running/done) */}
                        {(dedupStatus === 'idle' || dedupStatus === 'error') && (
                            <div className="space-y-4">
                                {/* Threshold */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-[#c0c5d0] mb-1">
                                        {t("Cosine Similarity Threshold")}
                                    </label>
                                    <input
                                        type="number"
                                        step={0.01}
                                        min={0}
                                        max={1}
                                        value={dedupThreshold}
                                        onChange={(e) => setDedupThreshold(Number(e.target.value))}
                                        aria-label="Cosine similarity threshold"
                                        className="w-full h-9 px-3 text-sm rounded-md border border-gray-300 dark:border-[#3a3f4e] bg-white dark:bg-[#111319] text-gray-900 dark:text-[#E6E6E6] focus:outline-none focus:ring-2 focus:ring-emerald-400"
                                    />
                                    <p className="mt-1 text-xs text-gray-500 dark:text-[#8a8f9e]">
                                        {t("Higher = stricter matching (0.85-0.95 recommended)")}
                                    </p>
                                </div>

                                {/* Apply Merge checkbox */}
                                <div>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={dedupApplyMerge}
                                            onChange={(e) => setDedupApplyMerge(e.target.checked)}
                                            className="w-4 h-4 rounded border-gray-300 text-emerald-500 focus:ring-emerald-400"
                                        />
                                        <span className="text-sm font-medium text-gray-700 dark:text-[#c0c5d0]">
                                            {t("Apply Merge")}
                                        </span>
                                    </label>
                                    {dedupApplyMerge && (
                                        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1.5 rounded">
                                            {t("This will permanently merge duplicate entities. This action cannot be undone.")}
                                        </p>
                                    )}
                                    {!dedupApplyMerge && (
                                        <p className="mt-1 text-xs text-gray-500 dark:text-[#8a8f9e]">
                                            {t("Dry run — preview what would be merged without changing the database.")}
                                        </p>
                                    )}
                                </div>

                                {/* Error message */}
                                {dedupError && (
                                    <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">
                                        {dedupError}
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="flex justify-end gap-2 pt-2">
                                    <button
                                        type="button"
                                        onClick={handleDedupClose}
                                        className="h-9 px-4 text-sm font-medium rounded-md border border-gray-300 dark:border-[#3a3f4e] text-gray-700 dark:text-[#c0c5d0] hover:bg-gray-50 dark:hover:bg-[#2a2f3e] transition-colors cursor-pointer"
                                    >
                                        {t("Cancel")}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleDedupSubmit}
                                        className={`h-9 px-4 text-sm font-medium rounded-md text-white transition-colors cursor-pointer ${
                                            dedupApplyMerge
                                                ? 'bg-red-600 hover:bg-red-700'
                                                : 'bg-emerald-600 hover:bg-emerald-700'
                                        }`}
                                    >
                                        {dedupApplyMerge ? t("Apply Merge") : t("Dry Run")}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Running spinner + progress */}
                        {dedupStatus === 'running' && (
                            <div className="flex flex-col items-center justify-center py-8 gap-4">
                                <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />

                                {dedupProgress ? (
                                    <div className="w-full space-y-2">
                                        <div className="flex justify-between text-xs text-gray-500 dark:text-[#8a8f9e]">
                                            <span>{t("Step {{step}}/{{total}}: {{name}}", { step: dedupProgress.step, total: dedupProgress.total_steps, name: dedupProgress.step_name })}</span>
                                            <span>{Math.round((dedupProgress.step / dedupProgress.total_steps) * 100)}%</span>
                                        </div>
                                        {/* Main step progress bar */}
                                        <div className="w-full h-2 bg-gray-200 dark:bg-[#2a2f3e] rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                                                style={{ width: `${(dedupProgress.step / dedupProgress.total_steps) * 100}%` }}
                                            />
                                        </div>
                                        {/* Sub-step progress (e.g. merging 3/15) */}
                                        {dedupProgress.total > 0 && (
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-xs text-gray-400 dark:text-[#5a5f6e]">
                                                    <span>{dedupProgress.current}/{dedupProgress.total}</span>
                                                </div>
                                                <div className="w-full h-1 bg-gray-200 dark:bg-[#2a2f3e] rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-emerald-400 rounded-full transition-all duration-300"
                                                        style={{ width: `${(dedupProgress.current / dedupProgress.total) * 100}%` }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-sm text-gray-600 dark:text-[#8a8f9e]">
                                        {t("Starting semantic dedup...")}
                                    </p>
                                )}

                                <p className="text-xs text-gray-400 dark:text-[#5a5f6e]">
                                    {t("You can close this dialog — the process will continue in the background.")}
                                </p>
                                <button
                                    type="button"
                                    onClick={handleDedupClose}
                                    className="mt-2 h-8 px-4 text-xs font-medium rounded-md border border-gray-300 dark:border-[#3a3f4e] text-gray-600 dark:text-[#c0c5d0] hover:bg-gray-50 dark:hover:bg-[#2a2f3e] transition-colors cursor-pointer"
                                >
                                    {t("Minimize")}
                                </button>
                            </div>
                        )}

                        {/* Results */}
                        {dedupStatus === 'done' && dedupResult && (
                            <div className="space-y-4">
                                {/* Summary card */}
                                <div className={`rounded-lg p-4 border ${
                                    dedupResult.summary.mode === 'applied'
                                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700'
                                        : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700'
                                }`}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className={`text-sm font-semibold ${
                                            dedupResult.summary.mode === 'applied'
                                                ? 'text-emerald-700 dark:text-emerald-300'
                                                : 'text-blue-700 dark:text-blue-300'
                                        }`}>
                                            {dedupResult.summary.mode === 'applied'
                                                ? t("Merge Applied")
                                                : t("Dry Run Complete")
                                            }
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-3 text-center">
                                        <div>
                                            <div className="text-2xl font-bold text-gray-900 dark:text-[#E6E6E6]">
                                                {dedupResult.summary.total_groups}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-[#8a8f9e]">{t("Groups")}</div>
                                        </div>
                                        <div>
                                            <div className="text-2xl font-bold text-gray-900 dark:text-[#E6E6E6]">
                                                {dedupResult.summary.entities_removed}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-[#8a8f9e]">{t("Removed")}</div>
                                        </div>
                                        <div>
                                            <div className="text-2xl font-bold text-gray-900 dark:text-[#E6E6E6]">
                                                {dedupResult.summary.relations_updated}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-[#8a8f9e]">{t("Relations")}</div>
                                        </div>
                                    </div>
                                    <div className="mt-2 text-xs text-gray-500 dark:text-[#8a8f9e] text-center">
                                        {t("Text duplicates: {{text}} · Semantic: {{semantic}}", {
                                            text: dedupResult.summary.text_dup_groups,
                                            semantic: dedupResult.summary.semantic_groups,
                                        })}
                                    </div>
                                </div>

                                {/* Merge list */}
                                {dedupResult.merges.length > 0 && (
                                    <div>
                                        <h3 className="text-sm font-medium text-gray-700 dark:text-[#c0c5d0] mb-2">
                                            {t("Merge Details")}
                                        </h3>
                                        <div className="space-y-2 max-h-60 overflow-y-auto">
                                            {dedupResult.merges.map((merge, idx) => (
                                                <div
                                                    key={idx}
                                                    className="p-3 rounded-md bg-gray-50 dark:bg-[#111319] border border-gray-200 dark:border-[#2a2f3e]"
                                                >
                                                    <div className="flex items-center gap-1.5 mb-1">
                                                        <span className="text-sm font-semibold text-gray-900 dark:text-[#E6E6E6]">
                                                            {merge.canonical}
                                                        </span>
                                                        <span className="text-xs text-gray-400 dark:text-[#5a5f6e]">
                                                            ({merge.refs_kept.source}→ {merge.refs_kept.target}←)
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {merge.aliases.map((alias) => (
                                                            <span
                                                                key={alias}
                                                                className="inline-flex items-center px-2 py-0.5 text-xs rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
                                                            >
                                                                ← {alias}
                                                            </span>
                                                        ))}
                                                    </div>
                                                    {/* eslint-disable-next-line eqeqeq */}
                                                    {merge.relations_redirected != null && merge.relations_redirected > 0 && (
                                                        <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                                                            {t("{{count}} relation(s) redirected", { count: merge.relations_redirected })}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* No merges found */}
                                {dedupResult.merges.length === 0 && (
                                    <p className="text-sm text-gray-500 dark:text-[#8a8f9e] text-center py-4">
                                        {t("No duplicate entities found at this threshold.")}
                                    </p>
                                )}

                                {/* Actions */}
                                <div className="flex justify-end gap-2 pt-2">
                                    <button
                                        type="button"
                                        onClick={handleDedupClose}
                                        className="h-9 px-4 text-sm font-medium rounded-md border border-gray-300 dark:border-[#3a3f4e] text-gray-700 dark:text-[#c0c5d0] hover:bg-gray-50 dark:hover:bg-[#2a2f3e] transition-colors cursor-pointer"
                                    >
                                        {t("Close")}
                                    </button>
                                    {dedupResult.summary.mode === 'applied' && (
                                        <button
                                            type="button"
                                            onClick={handleDedupRefreshGraph}
                                            className="h-9 px-4 text-sm font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors cursor-pointer"
                                        >
                                            {t("Refresh Graph")}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                    </div>
                </div>
            )}

        </div>
    )
}
