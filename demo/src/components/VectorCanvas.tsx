import React, { useCallback, useEffect, useRef, useState } from 'react';
import { findTopmostHitShape, translateShape } from '../cad/geometry';
import { renderGhostShape, renderGrid, renderShape } from '../cad/renderer';
import type { CadStore } from '../cad/store';
import type { CadDocument, CadShape } from '../cad/types';

export interface VectorCanvasProps {
    store: CadStore;
    width?: number;
    height?: number;
    className?: string;
    style?: React.CSSProperties;
}

interface ActiveDragState {
    shapeId: string;
    startX: number;
    startY: number;
    originShape: CadShape;
    currentDx: number;
    currentDy: number;
    hasPushedUndo?: boolean;
}

export const VectorCanvas: React.FC<VectorCanvasProps> = ({
    store,
    width = 760,
    height = 420,
    className,
    style,
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [documentData, setDocumentData] = useState<CadDocument>(store.doc.data);
    const activeDragRef = useRef<ActiveDragState | null>(null);
    const rafRef = useRef<number | null>(null);

    // Canvas draw routine
    const drawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.save();
        ctx.clearRect(0, 0, width, height);

        // Draw background grid
        renderGrid(ctx, width, height, 20, 1);

        const isTentative = store.doc.isTentative;
        const shapes = documentData.shapes || store.doc.data.shapes || {};

        for (const shape of Object.values(shapes)) {
            const isSelected = shape.id === documentData.selectedShapeId;

            if (isTentative) {
                renderGhostShape(ctx, shape, isSelected);
            } else {
                renderShape(ctx, shape, isSelected);
            }
        }

        ctx.restore();
    }, [documentData, store, width, height]);

    // Request RAF render
    const requestDraw = useCallback(() => {
        if (rafRef.current !== null) return;
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            drawCanvas();
        });
    }, [drawCanvas]);

    // Redraw on data change
    useEffect(() => {
        drawCanvas();
    }, [drawCanvas]);

    // REQ-1 & REQ-3: React to LiveDocument.$ stream updates
    useEffect(() => {
        const subscription = store.doc.$.subscribe((updatedDoc) => {
            setDocumentData(updatedDoc);
            requestDraw();
        });

        return () => {
            subscription.unsubscribe();
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [store, requestDraw]);

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            // Ignore capture error in unsupported environments
        }

        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const currentShapes = store.doc.data.shapes || documentData.shapes || {};
        const hit = findTopmostHitShape(mouseX, mouseY, currentShapes);

        if (hit) {
            if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
                const searchParams = new URLSearchParams(window.location.search);
                const viewport = searchParams.get('viewport');
                if (viewport) {
                    window.parent.postMessage({ type: 'cad-viewport-active', viewport }, '*');
                }
            }

            if (documentData.selectedShapeId !== hit.id) {
                void store.selectShape(hit.id);
            }
            activeDragRef.current = {
                shapeId: hit.id,
                startX: mouseX,
                startY: mouseY,
                originShape: { ...hit },
                currentDx: 0,
                currentDy: 0,
                hasPushedUndo: false,
            };
            drawCanvas();
        } else {
            if (documentData.selectedShapeId) {
                void store.selectShape(null);
            }
        }
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const drag = activeDragRef.current;
        if (drag) {
            const dx = mouseX - drag.startX;
            const dy = mouseY - drag.startY;

            if (!drag.hasPushedUndo && (dx !== 0 || dy !== 0)) {
                store.pushUndoSnapshot();
                drag.hasPushedUndo = true;
            }

            drag.currentDx = dx;
            drag.currentDy = dy;

            const translated = translateShape(drag.originShape, dx, dy);
            const updates: Partial<CadShape> = {
                x: translated.x,
                y: translated.y,
                ...(translated.x2 !== undefined ? { x2: translated.x2 } : {}),
                ...(translated.y2 !== undefined ? { y2: translated.y2 } : {}),
            };

            // Call doc.patch directly on drag move (transparent lazy commit & live overlay)
            void store.doc.patch({
                shapes: {
                    [drag.shapeId]: updates,
                },
            });
        } else {
            const hit = findTopmostHitShape(mouseX, mouseY, documentData.shapes || {});
            canvas.style.cursor = hit ? 'move' : 'default';
        }
    };

    const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        try {
            e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
            // Ignore
        }

        const drag = activeDragRef.current;
        if (drag) {
            activeDragRef.current = null;
            // Flush pending lazy patches immediately upon release (no await on UI path)
            void store.doc.flush();
            requestDraw();
        }
    }, [requestDraw, store]);

    return (
        <div
            className={className}
            style={{
                display: 'inline-flex',
                flexDirection: 'column',
                position: 'relative',
                background: '#090d16',
                border: '1px solid #334155',
                borderRadius: '8px',
                overflow: 'hidden',
                userSelect: 'none',
                ...style,
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: '#0f172a',
                    borderBottom: '1px solid #1e293b',
                    fontSize: '12px',
                    color: '#94a3b8',
                }}
            >
                <div style={{ display: 'flex', gap: '16px' }}>
                    <span>
                        Selected:{' '}
                        <strong style={{ color: '#f8fafc' }}>
                            {documentData.selectedShapeId ?? 'None'}
                        </strong>
                    </span>
                    <span>
                        Overlays Sent:{' '}
                        <strong style={{ color: '#38bdf8' }}>
                            {store.overlaysSent}
                        </strong>
                    </span>
                    <span>
                        SQLite Commits:{' '}
                        <strong style={{ color: '#4ade80' }}>{store.commits}</strong>
                    </span>
                </div>
                {store.doc.isTentative && (
                    <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>
                        Tentative Remote Overlay
                    </span>
                )}
            </div>

            <canvas
                ref={canvasRef}
                width={width}
                height={height}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{
                    display: 'block',
                    width: `${width}px`,
                    height: `${height}px`,
                    background: '#090d16',
                    touchAction: 'none',
                }}
            />
        </div>
    );
};
