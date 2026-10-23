import { observer } from "mobx-react";
import * as React from "react";
import { useHistory } from "react-router-dom";
import styled from "styled-components";
import { richExtensions, withComments } from "@shared/editor/nodes";
import { s } from "@shared/styles";
import Editor from "~/components/Editor";
import { HEADER_HEIGHT } from "~/components/Header";
import Spinner from "@shared/components/Spinner";
import PlaceholderText from "~/components/PlaceholderText";
import useDocumentChainList from "~/hooks/useDocumentChainList";
import useStores from "~/hooks/useStores";
import { documentPath } from "~/utils/routeHelpers";

/**
 * Maximum number of chained documents to keep in DOM at once (per direction).
 * This creates a "sliding window" of documents for performance.
 * When exceeded, the main document shifts to maintain the window.
 */
const WINDOW_SIZE = 10;

/**
 * How far ahead to start loading the next document.
 * Using viewport percentage (50% = half viewport height).
 */
const LOAD_THRESHOLD_PERCENT = 10;

/** Height of the placeholder shown while a chained document is loading. */
const LOADING_PLACEHOLDER_HEIGHT = 200;

const readOnlyExtensions = withComments(richExtensions);

interface LoadedDocument {
    id: string;
    index: number;
}

// ============================================================================
// Context for sharing state between Before and After components
// ============================================================================

interface ChainContextValue {
    nodes: ReturnType<typeof useDocumentChainList>["nodes"];
    currentIndex: number;
    loadedBefore: LoadedDocument[];
    loadedAfter: LoadedDocument[];
    setLoadedBefore: React.Dispatch<React.SetStateAction<LoadedDocument[]>>;
    setLoadedAfter: React.Dispatch<React.SetStateAction<LoadedDocument[]>>;
    documentRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
    mainDocumentId: string;
    /** Shift main document to the specified document ID. */
    shiftMainDocument: (newMainDocId: string) => void;
}

const ChainContext = React.createContext<ChainContextValue | null>(null);

// ============================================================================
// Provider Component
// ============================================================================

type ProviderProps = {
    mainDocumentId: string;
    collectionId: string;
    children: React.ReactNode;
};

function VirtualDocumentChainProvider({
    mainDocumentId,
    collectionId,
    children,
}: ProviderProps) {
    const { collections, documents } = useStores();
    const history = useHistory();
    const { nodes, currentIndex } = useDocumentChainList(
        mainDocumentId,
        collectionId
    );

    const [loadedBefore, setLoadedBefore] = React.useState<LoadedDocument[]>([]);
    const [loadedAfter, setLoadedAfter] = React.useState<LoadedDocument[]>([]);
    const documentRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());

    // Ensure collection documents are loaded
    React.useEffect(() => {
        const collection = collections.get(collectionId);
        if (collection) {
            void collection.fetchDocuments();
        }
    }, [collections, collectionId]);

    // Reset loaded documents when main document changes
    React.useEffect(() => {
        // eslint-disable-next-line no-console
        console.log('[VirtualDocumentChain] Main document changed, resetting arrays:', {
            newMainDocumentId: mainDocumentId.slice(0, 8),
            currentIndex,
        });
        setLoadedBefore([]);
        setLoadedAfter([]);
        documentRefs.current.clear();
    }, [mainDocumentId]);

    // Preload the previous document into cache so it renders immediately on scroll up
    React.useEffect(() => {
        if (currentIndex <= 0) {
            return;
        }
        const prevNode = nodes[currentIndex - 1];
        if (prevNode) {
            void documents.fetch(prevNode.id);
        }
    }, [currentIndex, nodes, documents]);

    // Shift main document to a new document (for sliding window)
    const shiftMainDocument = React.useCallback((newMainDocId: string) => {
        const newMainDoc = documents.get(newMainDocId);
        if (newMainDoc) {
            // eslint-disable-next-line no-console
            console.log('[VirtualDocumentChain] shiftMainDocument executing:', {
                from: mainDocumentId.slice(0, 8),
                to: newMainDocId.slice(0, 8),
                newPath: documentPath(newMainDoc),
            });
            // Use replaceState to update URL without adding history entry
            history.replace(documentPath(newMainDoc));
        }
    }, [documents, history, mainDocumentId]);

    const contextValue = React.useMemo(
        () => ({
            nodes,
            currentIndex,
            loadedBefore,
            loadedAfter,
            setLoadedBefore,
            setLoadedAfter,
            documentRefs,
            mainDocumentId,
            shiftMainDocument,
        }),
        [nodes, currentIndex, loadedBefore, loadedAfter, mainDocumentId, shiftMainDocument]
    );

    return (
        <ChainContext.Provider value={contextValue}>
            {children}
        </ChainContext.Provider>
    );
}

// ============================================================================
// Before Component (renders documents above main)
// ============================================================================

function VirtualDocumentChainBefore() {
    const context = React.useContext(ChainContext);
    const { documents, ui } = useStores();
    const sentinelRef = React.useRef<HTMLDivElement>(null);
    const contentRef = React.useRef<HTMLDivElement>(null);
    // Delay before allowing load (let page settle)
    const [isReady, setIsReady] = React.useState(false);
    // Prevent cascade loading - wait for previous document to render
    const [isLoadingPrev, setIsLoadingPrev] = React.useState(false);
    // Track which document is currently loading (for data-driven reset)
    const [loadingBeforeDocId, setLoadingBeforeDocId] = React.useState<string | undefined>(undefined);
    // Track scroll direction - only load previous when scrolling UP
    const lastScrollY = React.useRef(0);
    const isScrollingUp = React.useRef(false);
    // Track contentRef height to calculate scroll compensation on every render
    const prevContentHeightRef = React.useRef(0);
    const anchorRef = React.useRef<HTMLDivElement>(null);
    // Destructure context with defaults for when context is null
    const nodes = context?.nodes ?? [];
    const currentIndex = context?.currentIndex ?? -1;
    const loadedBefore = context?.loadedBefore ?? [];
    const setLoadedBefore = context?.setLoadedBefore;
    const setLoadedAfter = context?.setLoadedAfter;
    const documentRefs = context?.documentRefs;
    const mainDocumentId = context?.mainDocumentId ?? "";
    const shiftMainDocument = context?.shiftMainDocument;

    const hasPrevious = currentIndex > 0;

    // Compute previous node and whether its data is already cached (MobX reactive)
    const prevNode = hasPrevious ? nodes[currentIndex - 1] : undefined;
    const prevDocData = prevNode ? documents.get(prevNode.id)?.data : undefined;
    // MobX-reactive: observer re-renders when this changes, triggering the reset effect below
    const loadingDocData = loadingBeforeDocId ? documents.get(loadingBeforeDocId)?.data : undefined;

    // Disable browser scroll anchoring on the scroll container (html element) while
    // this component is mounted. Without this, when images in before-docs load and
    // content height grows, the browser auto-adjusts scrollY to maintain the viewport
    // anchor position — AND our ResizeObserver also adjusts → double compensation.
    // Setting overflow-anchor: none on the root disables browser anchoring entirely,
    // leaving our ResizeObserver as the sole compensation source.
    React.useEffect(() => {
        const prev = document.documentElement.style.overflowAnchor;
        document.documentElement.style.overflowAnchor = 'none';
        return () => {
            document.documentElement.style.overflowAnchor = prev;
        };
    }, []);

    // Delay before enabling load (let page settle after navigation)
    React.useEffect(() => {
        setIsReady(false);
        prevContentHeightRef.current = 0;

        const timer = setTimeout(() => {
            setIsReady(true);
        }, 500);

        return () => clearTimeout(timer);
    }, [mainDocumentId]);

    // Auto-add preloaded previous document so user can scroll up immediately
    //Already checked
    React.useEffect(() => {
        // Use ref to prevent re-running when MobX triggers re-renders (e.g., editing main doc)
        if (!isReady || !prevDocData || !prevNode || !setLoadedBefore) {
            return;
        }
        setIsLoadingPrev(true);
        setLoadingBeforeDocId(prevNode.id);
        setLoadedBefore([{ id: prevNode.id, index: currentIndex - 1 }]);
    }, [isReady, prevDocData, prevNode?.id, currentIndex, setLoadedBefore]);

    // Track scroll direction (simple - just track last vs current)
    React.useEffect(() => {
        lastScrollY.current = window.scrollY;

        const handleScroll = () => {
            const currentY = window.scrollY;
            isScrollingUp.current = currentY < lastScrollY.current;
            lastScrollY.current = currentY;
        };

        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, [mainDocumentId]);

    // Load previous document when scrolling up (after page has settled)
    React.useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel || !hasPrevious || !setLoadedBefore || !setLoadedAfter || !isReady || isLoadingPrev) {
            return;
        }

        // Calculate threshold based on viewport height
        const thresholdPx = Math.round(window.innerHeight * LOAD_THRESHOLD_PERCENT / 100);

        const handleScroll = () => {
            // Only load when scrolling UP
            if (!isScrollingUp.current) {
                return;
            }

            // Check if sentinel is within threshold from viewport
            const rect = sentinel.getBoundingClientRect();
            if (rect.bottom < -thresholdPx || rect.top > window.innerHeight + thresholdPx) {
                return; // Sentinel not in range
            }

            setLoadedBefore((prev) => {
                const firstIndex = prev.length > 0 ? prev[0].index : currentIndex;
                const prevIndex = firstIndex - 1;

                if (prevIndex < 0) {
                    return prev;
                }

                const prevNode = nodes[prevIndex];
                // Skip if: node doesn't exist, already loaded, or is the main document
                if (
                    !prevNode ||
                    prevNode.id === mainDocumentId ||
                    prev.some((d) => d.id === prevNode.id)
                ) {
                    return prev;
                }

                // WINDOW_SIZE check: if we would exceed the limit, shift main doc
                if (prev.length >= WINDOW_SIZE) {
                    const newMainDoc = prev[0]; // topmost = where user currently is
                    // eslint-disable-next-line no-console
                    console.log('[Before] WINDOW_SIZE hit — shifting to topmost:', {
                        currentMain: mainDocumentId.slice(0, 8),
                        shiftTo: newMainDoc?.id.slice(0, 8),
                        loadedBeforeLength: prev.length,
                        WINDOW_SIZE,
                    });
                    if (newMainDoc && shiftMainDocument) {
                        setTimeout(() => {
                            shiftMainDocument(newMainDoc.id);
                        }, 0);
                    }
                    return prev; // Don't modify array, navigation will reset it
                }

                // Fetch document data and mark as loading
                setIsLoadingPrev(true);
                setLoadingBeforeDocId(prevNode.id);
                void documents.fetch(prevNode.id);

                const newList = [{ id: prevNode.id, index: prevIndex }, ...prev];
                // eslint-disable-next-line no-console
                console.log('[VirtualDocumentChain] loadedBefore updated:', {
                    added: { id: prevNode.id, index: prevIndex },
                    total: newList.length,
                    list: newList.map(d => ({ id: d.id.slice(0, 8), index: d.index })),
                    mainDocumentId: mainDocumentId.slice(0, 8),
                    WINDOW_SIZE,
                });
                return newList;
            });
        };

        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, [isReady, hasPrevious, currentIndex, nodes, documents, setLoadedBefore, setLoadedAfter, mainDocumentId, isLoadingPrev, shiftMainDocument]);

    // Reset loading flag when the loading document's data becomes available (MobX reactive).
    // Since this component is wrapped in observer(), loadingDocData is tracked: when the
    // document arrives in the store, MobX re-renders → useEffect re-runs → flags cleared.
    React.useEffect(() => {
        if (!isLoadingPrev || !loadingBeforeDocId) {
            return undefined;
        }

        if (loadingDocData) {
            // Data is available — reset immediately (covers cached docs too)
            setIsLoadingPrev(false);
            setLoadingBeforeDocId(undefined);
            return undefined;
        }

        // Fallback: unblock after 10s in case of fetch failure
        const timer = setTimeout(() => {
            setIsLoadingPrev(false);
            setLoadingBeforeDocId(undefined);
        }, 10000);
        return () => clearTimeout(timer);
    }, [loadingDocData, loadingBeforeDocId, isLoadingPrev]);

    // Compensate scroll position whenever prepended content height changes.
    // Runs on EVERY render (no deps) so it captures both:
    //   - New docs added to loadedBefore (length change)
    //   - LoadingPlaceholder → full content transition (same length, bigger height)
    // useLayoutEffect fires before browser paint → no visual jump.
    //
    // Logic:
    //   prevContentHeightRef = 0  → first prepend after navigation:
    //     use anchorRef.getBoundingClientRect() for accurate position (captures
    //     collapsed CSS margins that contentRef.offsetHeight misses), then
    //     scrollTo so the main doc starts just below the sticky header.
    //   prevContentHeightRef > 0  → subsequent height increase:
    //     scrollBy(diff) to maintain current viewport position.
    //Already checked
    React.useLayoutEffect(() => {
        const content = contentRef.current;
        if (!content || loadedBefore.length === 0) {
            return;
        }

        const currentHeight = content.offsetHeight;
        const prevHeight = prevContentHeightRef.current;
        const diff = currentHeight - prevHeight;

        // Only update the tracked height when we actually compensate (height increased).
        // Do NOT update on height-decrease or no-change — prevents a stale small value
        // from inflating diff on the next render and causing a large spurious scrollBy.
        if (diff <= 0) {
            return;
        }

        prevContentHeightRef.current = currentHeight;

        if (prevHeight === 0) {
            if (ui.scrollRestorationActive) {
                // Pixel offset scroll: restoration vừa hoàn thành — dùng scrollBy để
                // bù cho before-doc được prepend mà không reset về đầu doc.
                // Consume flag để các prepend sau hoạt động bình thường.
                // eslint-disable-next-line no-console
                console.log('[Before/useLayoutEffect] scrollRestorationActive path', { currentHeight, scrollY: window.scrollY });
                window.scrollBy(0, LOADING_PLACEHOLDER_HEIGHT - HEADER_HEIGHT);
                ui.setScrollRestorationActive(false);
            } else {
                // First prepend: use anchorRef for the accurate page boundary
                const anchor = anchorRef.current;
                if (anchor) {
                    const anchorOffset = anchor.getBoundingClientRect().top + window.scrollY;
                    // eslint-disable-next-line no-console
                    console.log('[Before/useLayoutEffect] prevHeight=0 → scrollTo', { currentHeight, anchorTop: anchor.getBoundingClientRect().top, anchorOffset, scrollYBefore: window.scrollY, scrollYAfter: anchorOffset - HEADER_HEIGHT });
                    window.scrollTo(0, anchorOffset - HEADER_HEIGHT);
                }
            }
        } else {
            // Subsequent prepend: maintain viewport position
            // eslint-disable-next-line no-console
            console.log('[Before/useLayoutEffect] scrollBy', { diff, prevHeight, currentHeight, scrollY: window.scrollY });
            window.scrollBy(0, diff);
        }
    });

    // [V2] ResizeObserver: catch height changes that useLayoutEffect misses.
    //
    // useLayoutEffect only fires on React re-renders — it cannot detect height
    // changes caused by async image loads in prepended documents. When an image
    // finishes loading, the document below it shifts down, creating a scroll jump.
    //
    // ResizeObserver fires on ANY size change of contentRef, including post-render
    // image loads. Because useLayoutEffect runs before ResizeObserver and already
    // updates prevContentHeightRef for React-driven changes, the diff seen by
    // ResizeObserver for those cases is 0 → no double-compensation.
    // Only image-driven height changes (where prevContentHeightRef is stale) produce
    // a non-zero diff and trigger a scrollBy correction.
    React.useEffect(() => {
        const content = contentRef.current;
        if (!content) {
            return;
        }

        const observer = new ResizeObserver(() => {
            // Guard: only active after first prepend has been handled by useLayoutEffect.
            // prevContentHeightRef = 0 means no before-docs yet → nothing to compensate.
            if (prevContentHeightRef.current === 0) {
                return;
            }

            const currentHeight = content.offsetHeight;
            const diff = currentHeight - prevContentHeightRef.current;

            if (diff <= 0) {
                return;
            }

            // eslint-disable-next-line no-console
            console.log('[Before/ResizeObserver] scrollBy', { diff, prevHeight: prevContentHeightRef.current, currentHeight, scrollY: window.scrollY });
            prevContentHeightRef.current = currentHeight;
            window.scrollBy(0, diff);
        });

        observer.observe(content);
        return () => observer.disconnect();
    }, []); // Attach once — reads only from refs, no stale closures

    // Track scroll for sidebar highlighting (before documents)
    const currentActiveIdBefore = React.useRef(mainDocumentId);

    React.useEffect(() => {
        currentActiveIdBefore.current = mainDocumentId;
    }, [mainDocumentId]);

    React.useEffect(() => {
        if (loadedBefore.length === 0 || !documentRefs) {
            return;
        }

        const handleScroll = () => {
            for (const doc of [...loadedBefore].reverse()) {
                const el = documentRefs.current.get(doc.id);
                if (el) {
                    const rect = el.getBoundingClientRect();
                    if (rect.top < window.innerHeight / 2 && rect.bottom > HEADER_HEIGHT) {
                        if (currentActiveIdBefore.current !== doc.id) {
                            currentActiveIdBefore.current = doc.id;
                            ui.setActiveDocument(doc.id);
                        }
                        // Pixel offset scroll: cập nhật offset mỗi scroll event trong before-doc
                        // offset = số px của doc đã scroll qua đáy header → dùng để restore khi click badge
                        ui.setPendingScrollOffset(Math.max(0, -rect.top + HEADER_HEIGHT));
                        return;
                    }
                }
            }

            // No before-doc is active — restore to main document
            if (currentActiveIdBefore.current !== mainDocumentId) {
                currentActiveIdBefore.current = mainDocumentId;
                ui.setActiveDocument(mainDocumentId);
                // Pixel offset scroll: clear offset khi trở về main doc
                ui.setPendingScrollOffset(undefined);
            }
        };

        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, [loadedBefore, mainDocumentId, documentRefs, ui]);

    const setDocumentRef = React.useCallback(
        (id: string) => (el: HTMLDivElement | null) => {
            if (el && documentRefs) {
                documentRefs.current.set(id, el);
            }
        },
        [documentRefs]
    );

    if (!context) {
        return null;
    }

    return (
        <>
            <Sentinel ref={sentinelRef} />
            {!isReady && hasPrevious && loadedBefore.length === 0 && (
                <ShiftPlaceholderContainer>
                    <PlaceholderText minWidth={60} maxWidth={90} />
                    <PlaceholderText minWidth={70} maxWidth={85} delay={0.1} />
                    <PlaceholderText minWidth={50} maxWidth={75} delay={0.2} />
                    <PlaceholderText minWidth={65} maxWidth={80} delay={0.3} />
                </ShiftPlaceholderContainer>
            )}
            {/* overflow-anchor: none — disable browser scroll anchoring so our manual
                scrollBy/scrollTo in useLayoutEffect is the sole compensation source.
                Without this, browser anchoring + scrollBy would double-compensate. */}
            <div ref={contentRef} style={{ overflowAnchor: 'none' }}>
                {loadedBefore.map((doc) => {
                    const docData = documents.get(doc.id);

                    if (!docData?.data) {
                        return (
                            <LoadingContainer key={doc.id}>
                                <Spinner />
                            </LoadingContainer>
                        );
                    }

                    return (
                        <ChainedDocument key={doc.id} ref={setDocumentRef(doc.id)}>
                            <ChainedDocumentHeader>
                                <ChainedTitle>
                                    {docData.icon && <span>{docData.icon} </span>}
                                    {docData.titleWithDefault}
                                </ChainedTitle>
                            </ChainedDocumentHeader>
                            <Editor
                                defaultValue={docData.data}
                                extensions={readOnlyExtensions}
                                readOnly
                            />
                            <Divider />
                        </ChainedDocument>
                    );
                })}
            </div>
            {/* Zero-height anchor used by useLayoutEffect to measure the true
                boundary between before-docs and main doc (including CSS margins) */}
            <div ref={anchorRef} style={{ height: 0 }} />
        </>
    );
}

// ============================================================================
// After Component (renders documents below main)
// ============================================================================

function VirtualDocumentChainAfter() {
    const context = React.useContext(ChainContext);
    const { documents, ui } = useStores();
    const sentinelRef = React.useRef<HTMLDivElement>(null);

    // Destructure context with defaults for when context is null
    const nodes = context?.nodes ?? [];
    const currentIndex = context?.currentIndex ?? -1;
    const loadedAfter = context?.loadedAfter ?? [];
    const setLoadedBefore = context?.setLoadedBefore;
    const setLoadedAfter = context?.setLoadedAfter;
    const documentRefs = context?.documentRefs;
    const mainDocumentId = context?.mainDocumentId ?? "";
    const shiftMainDocument = context?.shiftMainDocument;

    const hasNext = currentIndex < nodes.length - 1 && currentIndex !== -1;

    // MobX-reactive: tracks whether the main doc's content is loaded.
    // After a window shift, the new main doc may not be in cache yet.
    // We must wait for it to load before watching the sentinel — otherwise the
    // sentinel sits in an almost-empty viewport, IntersectionObserver fires
    // once, adds a loading placeholder, then never fires again (no state change).
    const mainDocData = documents.get(mainDocumentId)?.data;

    // isReady: true after main doc content is available + short settle delay.
    const [isReady, setIsReady] = React.useState(false);

    // isShiftPlaceholderVisible: independent 500ms timer for the shift placeholder.
    // Decoupled from isReady so IntersectionObserver attachment (300ms) and
    // placeholder duration (500ms) can evolve separately.
    const [isShiftPlaceholderVisible, setIsShiftPlaceholderVisible] = React.useState(false);

    React.useEffect(() => {
        setIsShiftPlaceholderVisible(true);
        const timer = setTimeout(() => {
            setIsShiftPlaceholderVisible(false);
        }, 1000);
        return () => clearTimeout(timer);
    }, [mainDocumentId]);

    // Block user scroll while shift placeholder is visible so the page
    // doesn't jump before chained docs are ready.
    React.useEffect(() => {
        if (!isShiftPlaceholderVisible) {
            return;
        }
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [isShiftPlaceholderVisible]);

    React.useEffect(() => {
        if (!mainDocData) {
            // eslint-disable-next-line no-console
            console.log('[After] mainDocData not ready — observer paused:', {
                mainDocumentId: mainDocumentId.slice(0, 8),
            });
            setIsReady(false);
            return;
        }
        // Main doc is rendered — wait a tick for layout to stabilise before
        // attaching the sentinel observer so it starts below the fold.
        // eslint-disable-next-line no-console
        console.log('[After] mainDocData available — starting 300ms settle timer:', {
            mainDocumentId: mainDocumentId.slice(0, 8),
        });
        const timer = setTimeout(() => {
            // eslint-disable-next-line no-console
            console.log('[After] isReady = true, attaching sentinel observer:', {
                mainDocumentId: mainDocumentId.slice(0, 8),
                hasNext,
            });
            setIsReady(true);
        }, 300);
        return () => clearTimeout(timer);
    }, [mainDocumentId, mainDocData]);

    // Load next document when scrolling down
    React.useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel || !hasNext || !setLoadedAfter || !setLoadedBefore || !isReady) {
            return;
        }

        // Calculate rootMargin based on viewport height
        const rootMarginPx = Math.round(window.innerHeight * LOAD_THRESHOLD_PERCENT / 100);

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setLoadedAfter((prev) => {
                        const lastIndex =
                            prev.length > 0 ? prev[prev.length - 1].index : currentIndex;
                        const nextIndex = lastIndex + 1;

                        if (nextIndex >= nodes.length) {
                            return prev;
                        }

                        const nextNode = nodes[nextIndex];
                        // Skip if: node doesn't exist, already loaded, or is the main document
                        if (
                            !nextNode ||
                            nextNode.id === mainDocumentId ||
                            prev.some((d) => d.id === nextNode.id)
                        ) {
                            return prev;
                        }

                        // WINDOW_SIZE check: if we would exceed the limit, shift main doc
                        if (prev.length >= WINDOW_SIZE) {
                            // Shift to nextNode (doc user is entering), not prev[last] (doc already read).
                            // This way: after reset, nextNode becomes main, prev doc is in Before, and
                            // user continues reading without any visual disappear/reappear.
                            // Pre-fetch nextNode so it's in cache when navigation lands —
                            // this reduces the "loading" period that could keep the sentinel
                            // inside the viewport and stall the observer.
                            // eslint-disable-next-line no-console
                            console.log('[After] WINDOW_SIZE hit — pre-fetching & shifting to nextNode:', {
                                currentMain: mainDocumentId.slice(0, 8),
                                shiftTo: nextNode.id.slice(0, 8),
                                loadedAfterLength: prev.length,
                                WINDOW_SIZE,
                            });
                            void documents.fetch(nextNode.id);
                            if (shiftMainDocument) {
                                setTimeout(() => {
                                    shiftMainDocument(nextNode.id);
                                }, 0);
                            }
                            return prev; // Don't modify array, navigation will reset it
                        }

                        // Fetch document data
                        void documents.fetch(nextNode.id);

                        const newList = [...prev, { id: nextNode.id, index: nextIndex }];
                        // eslint-disable-next-line no-console
                        console.log('[VirtualDocumentChain] loadedAfter updated:', {
                            added: { id: nextNode.id, index: nextIndex },
                            total: newList.length,
                            list: newList.map(d => ({ id: d.id.slice(0, 8), index: d.index })),
                            mainDocumentId: mainDocumentId.slice(0, 8),
                            WINDOW_SIZE,
                        });
                        return newList;
                    });
                }
            },
            { rootMargin: `${rootMarginPx}px` }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [isReady, hasNext, currentIndex, documents, setLoadedAfter, setLoadedBefore, mainDocumentId, shiftMainDocument, nodes]);

    // Track scroll for sidebar highlighting (after documents)
    const currentActiveIdAfter = React.useRef(mainDocumentId);

    React.useEffect(() => {
        currentActiveIdAfter.current = mainDocumentId;
    }, [mainDocumentId]);

    React.useEffect(() => {
        if (loadedAfter.length === 0 || !documentRefs) {
            return;
        }

        const handleScroll = () => {
            for (const doc of [...loadedAfter].reverse()) {
                const el = documentRefs.current.get(doc.id);
                if (el) {
                    const rect = el.getBoundingClientRect();
                    if (rect.top < window.innerHeight / 2 && rect.bottom > 0) {
                        if (currentActiveIdAfter.current !== doc.id) {
                            currentActiveIdAfter.current = doc.id;
                            ui.setActiveDocument(doc.id);
                        }
                        // Pixel offset scroll: cập nhật offset mỗi scroll event trong after-doc
                        // offset = số px của doc đã scroll qua đáy header → dùng để restore khi click badge
                        ui.setPendingScrollOffset(Math.max(0, -rect.top + HEADER_HEIGHT));
                        return;
                    }
                }
            }

            // No after-doc is active — restore to main document
            if (currentActiveIdAfter.current !== mainDocumentId) {
                currentActiveIdAfter.current = mainDocumentId;
                ui.setActiveDocument(mainDocumentId);
                // Pixel offset scroll: clear offset khi trở về main doc
                ui.setPendingScrollOffset(undefined);
            }
        };

        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, [loadedAfter, mainDocumentId, documentRefs, ui]);

    const setDocumentRef = React.useCallback(
        (id: string) => (el: HTMLDivElement | null) => {
            if (el && documentRefs) {
                documentRefs.current.set(id, el);
            }
        },
        [documentRefs]
    );

    if (!context) {
        return null;
    }

    return (
        <>
            {loadedAfter.map((doc) => {
                const docData = documents.get(doc.id);

                if (!docData?.data) {
                    return (
                        <LoadingContainer key={doc.id}>
                            <Spinner />
                        </LoadingContainer>
                    );
                }

                return (
                    <ChainedDocument key={doc.id} ref={setDocumentRef(doc.id)}>
                        <Divider />
                        <ChainedDocumentHeader>
                            <ChainedTitle>
                                {docData.icon && <span>{docData.icon} </span>}
                                {docData.titleWithDefault}
                            </ChainedTitle>
                        </ChainedDocumentHeader>
                        <Editor
                            defaultValue={docData.data}
                            extensions={readOnlyExtensions}
                            readOnly
                        />
                    </ChainedDocument>
                );
            })}
            {isShiftPlaceholderVisible && hasNext && loadedAfter.length === 0 && (
                <ShiftPlaceholderContainer>
                    <PlaceholderText minWidth={60} maxWidth={90} />
                    <PlaceholderText minWidth={70} maxWidth={85} delay={0.1} />
                    <PlaceholderText minWidth={50} maxWidth={75} delay={0.2} />
                    <PlaceholderText minWidth={65} maxWidth={80} delay={0.3} />
                </ShiftPlaceholderContainer>
            )}
            <Sentinel ref={sentinelRef} />
        </>
    );
}

// ============================================================================
// Hook to get chain status
// ============================================================================

export function useDocumentChainStatus(
    mainDocumentId: string,
    collectionId: string | null | undefined
): { hasPrevious: boolean; hasNext: boolean } {
    const { nodes, currentIndex } = useDocumentChainList(
        mainDocumentId,
        collectionId
    );

    return {
        hasPrevious: currentIndex > 0,
        hasNext: currentIndex < nodes.length - 1 && currentIndex !== -1,
    };
}

// ============================================================================
// Styled Components
// ============================================================================

const Sentinel = styled.div`
  height: 1px;
`;

const ChainedDocument = styled.div`
    //min-height: calc(100vh - ${HEADER_HEIGHT}px);
`;

const Divider = styled.hr`
  border: 0;
  border-top: 1px solid ${s("divider")};
  margin: 32px 0;
`;

const ChainedDocumentHeader = styled.div`
  margin-bottom: 16px;
`;

const ChainedTitle = styled.h1`
  font-size: 2em;
  font-weight: 600;
  color: ${s("text")};
  margin: 0;
`;

const LoadingContainer = styled.div`
  height: ${LOADING_PLACEHOLDER_HEIGHT}px;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const ShiftPlaceholderContainer = styled.div`
  padding: 32px 0;
  display: flex;
  flex-direction: column;
`;

// ============================================================================
// Exports
// ============================================================================

export const VirtualDocumentChain = {
    Provider: observer(VirtualDocumentChainProvider),
    Before: observer(VirtualDocumentChainBefore),
    After: observer(VirtualDocumentChainAfter),
};

export default VirtualDocumentChain;
