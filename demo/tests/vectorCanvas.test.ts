import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
    getBoundingBox,
    findTopmostHitShape,
    translateShape,
    getTransformHandles,
    pointToSegmentDistance,
} from '../src/cad/geometry';
import {
    renderGrid,
    renderSelectionBox,
    renderShape,
    renderRemotePreview,
} from '../src/cad/renderer';
import { CadStore, initCadStore } from '../src/cad/store';
import { CAD_DRAG_CHANNEL, type CadShape, type CursorDragPayload } from '../src/cad/types';

describe('Geometry Calculations', () => {
    const testShapes: Record<string, CadShape> = {
        'rect-1': {
            id: 'rect-1',
            type: 'rect',
            x: 50,
            y: 50,
            width: 100,
            height: 80,
            name: 'Box',
        },
        'circle-1': {
            id: 'circle-1',
            type: 'circle',
            x: 250,
            y: 100,
            radius: 30,
            name: 'Pin',
        },
        'line-1': {
            id: 'line-1',
            type: 'line',
            x: 10,
            y: 200,
            x2: 110,
            y2: 200,
            strokeWidth: 4,
            name: 'Ruler',
        },
    };

    it('calculates bounding box correctly for rect, circle, and line', () => {
        const rectBox = getBoundingBox(testShapes['rect-1']);
        expect(rectBox).toEqual({ x: 50, y: 50, width: 100, height: 80 });

        const circleBox = getBoundingBox(testShapes['circle-1']);
        expect(circleBox).toEqual({ x: 220, y: 70, width: 60, height: 60 });

        const lineBox = getBoundingBox(testShapes['line-1']);
        expect(lineBox).toEqual({ x: 10, y: 200, width: 100, height: 0 });
    });

    it('calculates pointToSegmentDistance correctly', () => {
        // Point right on segment
        expect(pointToSegmentDistance(50, 200, 10, 200, 110, 200)).toBe(0);
        // Point perpendicular to segment midpoint
        expect(pointToSegmentDistance(50, 210, 10, 200, 110, 200)).toBe(10);
        // Point beyond segment start
        expect(pointToSegmentDistance(0, 200, 10, 200, 110, 200)).toBe(10);
        // Point beyond segment end
        expect(pointToSegmentDistance(120, 200, 10, 200, 110, 200)).toBe(10);
    });

    it('finds topmost hit shape with proper hit testing and z-ordering', () => {
        // Hit inside rect
        const hitRect = findTopmostHitShape(70, 70, testShapes);
        expect(hitRect?.id).toBe('rect-1');

        // Hit inside circle
        const hitCircle = findTopmostHitShape(255, 105, testShapes);
        expect(hitCircle?.id).toBe('circle-1');

        // Hit near line
        const hitLine = findTopmostHitShape(50, 202, testShapes);
        expect(hitLine?.id).toBe('line-1');

        // Miss outside all shapes
        const miss = findTopmostHitShape(500, 500, testShapes);
        expect(miss).toBeNull();
    });

    it('returns the topmost shape when shapes overlap', () => {
        const overlappingShapes: Record<string, CadShape> = {
            bottom: {
                id: 'bottom',
                type: 'rect',
                x: 0,
                y: 0,
                width: 100,
                height: 100,
            },
            top: {
                id: 'top',
                type: 'rect',
                x: 20,
                y: 20,
                width: 50,
                height: 50,
            },
        };

        const hit = findTopmostHitShape(30, 30, overlappingShapes);
        expect(hit?.id).toBe('top');
    });

    it('translates shape coordinates correctly', () => {
        const translatedRect = translateShape(testShapes['rect-1'], 15, -10);
        expect(translatedRect.x).toBe(65);
        expect(translatedRect.y).toBe(40);

        const translatedLine = translateShape(testShapes['line-1'], 20, 30);
        expect(translatedLine.x).toBe(30);
        expect(translatedLine.y).toBe(230);
        expect(translatedLine.x2).toBe(130);
        expect(translatedLine.y2).toBe(230);
    });

    it('generates four corner transform handles for bounding box', () => {
        const handles = getTransformHandles(testShapes['rect-1']);
        expect(handles.length).toBe(4);
        expect(handles[0]).toEqual({ id: 'nw', x: 50, y: 50, cursor: 'nwse-resize' });
        expect(handles[1]).toEqual({ id: 'ne', x: 150, y: 50, cursor: 'nesw-resize' });
        expect(handles[2]).toEqual({ id: 'se', x: 150, y: 130, cursor: 'nwse-resize' });
        expect(handles[3]).toEqual({ id: 'sw', x: 50, y: 130, cursor: 'nesw-resize' });
    });
});

describe('CadStore and Vector Canvas Requirements', () => {
    let store: CadStore;

    beforeEach(async () => {
        store = await initCadStore({
            name: 'test_cad_' + Math.random().toString(36).substring(2, 9),
            forceMemory: true,
        });
    });

    afterEach(async () => {
        await store.close();
    });

    it('REQ-1: Dragging primitives directly patches doc.data in-memory without synchronous disk writes', async () => {
        expect(store.commits).toBe(0);

        // Simulate 60 rapid drag patches directly to doc.patch (transparent lazy commit)
        const frameCount = 60;
        for (let i = 1; i <= frameCount; i++) {
            void store.doc.patch({
                shapes: {
                    'rect-1': {
                        x: 60 + i,
                        y: 60 + i * 2,
                    },
                },
            });
        }

        // Memory snapshot reflects the latest position immediately
        expect(store.doc.data.shapes['rect-1'].x).toBe(60 + frameCount);
        expect(store.doc.data.shapes['rect-1'].y).toBe(60 + frameCount * 2);

        // CRITICAL REQ-1 ASSERTION: ZERO commits occurred to SQLite synchronously during drag
        expect(store.commits).toBe(0);
        expect(store.doc.isPending).toBe(true);
    });

    it('REQ-2: Releasing mouse (flush) executes exactly one doc.patch commit to SQLite OPFS', async () => {
        // Dragging phase: 30 lazy patch calls, 0 disk commits
        for (let i = 1; i <= 30; i++) {
            void store.doc.patch({
                shapes: {
                    'rect-1': {
                        x: 60 + i,
                        y: 60 + i,
                    },
                },
            });
        }
        expect(store.commits).toBe(0);

        // MouseUp phase: flushing lazy patches commits to SQLite
        const finalX = 60 + 30;
        const finalY = 60 + 30;
        await store.doc.flush();

        // CRITICAL REQ-2 ASSERTION: Exactly one commit was executed
        expect(store.commits).toBe(1);

        // Document snapshot reflects committed coordinates
        expect(store.doc.data.shapes['rect-1'].x).toBe(finalX);
        expect(store.doc.data.shapes['rect-1'].y).toBe(finalY);

        // RFC 7396 merge patch preserved unmutated shape properties and other shapes
        expect(store.doc.data.shapes['rect-1'].width).toBe(140);
        expect(store.doc.data.shapes['rect-1'].name).toBe('Main Bracket');
        expect(store.doc.data.shapes['circle-1']).toBeDefined();
        expect(store.doc.data.shapes['line-1']).toBeDefined();
    });

    it('Scripted drag benchmark: 300 moves at 8ms interval produces <= 4 commits', async () => {
        expect(store.commits).toBe(0);

        const startTime = Date.now();
        const targetDuration = 2400; // 2.4s target duration for 300 moves at 8ms
        const totalMoves = 300;

        // 300 drag moves along a path over ~2.4s
        for (let i = 1; i <= totalMoves; i++) {
            void store.doc.patch({
                shapes: {
                    'rect-1': {
                        x: 60 + i,
                        y: 60 + i,
                    },
                },
            });

            const targetElapsed = (i / totalMoves) * targetDuration;
            const delay = targetElapsed - (Date.now() - startTime);
            if (delay > 1) {
                await new Promise((resolve) => setTimeout(resolve, delay));
            } else if (i % 20 === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }

        await store.doc.flush();

        // 2.4s of dragging with 1000ms maxCommitWait produces <= 4 commits
        expect(store.commits).toBeLessThanOrEqual(4);
        expect(store.doc.data.shapes['rect-1'].x).toBe(60 + totalMoves);
    });

    it('REQ-3: Canvas reacts to external LiveDocument.$ stream updates caused by changes in other tabs', async () => {
        const snapshots: number[] = [];

        // UI component subscription to doc.$
        const sub = store.doc.$.subscribe((doc) => {
            snapshots.push(doc.shapes['rect-1'].x);
        });

        // Initial snapshot emitted on subscribe
        expect(snapshots).toEqual([60]);

        // External update 1 (e.g. from tab B)
        await store.doc.patch({
            shapes: {
                'rect-1': { x: 150 },
            },
        });

        // External update 2
        await store.doc.patch({
            shapes: {
                'rect-1': { x: 220 },
            },
        });

        expect(snapshots).toEqual([60, 150, 220]);
        expect(store.doc.data.shapes['rect-1'].x).toBe(220);

        sub.unsubscribe();
    });

    it('updates selection and shape properties cleanly', async () => {
        expect(store.doc.data.selectedShapeId).toBe('rect-1');

        await store.selectShape('circle-1');
        expect(store.doc.data.selectedShapeId).toBe('circle-1');

        await store.updateShapeProperties('circle-1', { fill: '#ec4899', radius: 55 });
        expect(store.doc.data.shapes['circle-1'].fill).toBe('#ec4899');
        expect(store.doc.data.shapes['circle-1'].radius).toBe(55);
    });
});

describe('Renderer Drawing Routines', () => {
    const mockCtx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        arc: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        setLineDash: vi.fn(),
        fillText: vi.fn(),
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1,
        globalAlpha: 1,
        font: '',
    } as unknown as CanvasRenderingContext2D;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders grid without throwing', () => {
        renderGrid(mockCtx, 400, 300, 20, 1);
        expect(mockCtx.save).toHaveBeenCalled();
        expect(mockCtx.beginPath).toHaveBeenCalled();
        expect(mockCtx.stroke).toHaveBeenCalled();
        expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('renders rectangle, circle, and line primitives', () => {
        const rect: CadShape = { id: 'r1', type: 'rect', x: 10, y: 10, width: 40, height: 40 };
        const circle: CadShape = { id: 'c1', type: 'circle', x: 50, y: 50, radius: 20 };
        const line: CadShape = { id: 'l1', type: 'line', x: 0, y: 0, x2: 100, y2: 100 };

        renderShape(mockCtx, rect);
        expect(mockCtx.fillRect).toHaveBeenCalledWith(10, 10, 40, 40);

        renderShape(mockCtx, circle);
        expect(mockCtx.arc).toHaveBeenCalledWith(50, 50, 20, 0, Math.PI * 2);

        renderShape(mockCtx, line);
        expect(mockCtx.moveTo).toHaveBeenCalledWith(0, 0);
        expect(mockCtx.lineTo).toHaveBeenCalledWith(100, 100);
    });

    it('renders selection box with transform handles when isSelected is true', () => {
        const rect: CadShape = { id: 'r1', type: 'rect', x: 20, y: 20, width: 60, height: 40 };
        renderShape(mockCtx, rect, true);

        expect(mockCtx.setLineDash).toHaveBeenCalledWith([4, 4]);
        expect(mockCtx.strokeRect).toHaveBeenCalled();
    });

    it('renders remote preview ghost and badge', () => {
        const rect: CadShape = {
            id: 'r1',
            type: 'rect',
            x: 20,
            y: 20,
            width: 60,
            height: 40,
            name: 'Bracket',
        };
        const payload: CursorDragPayload = {
            shapeId: 'r1',
            x: 50,
            y: 50,
            dx: 30,
            dy: 30,
            timestamp: Date.now(),
        };

        renderRemotePreview(mockCtx, rect, payload);
        expect(mockCtx.fillText).toHaveBeenCalledWith(
            expect.stringContaining('Remote Drag: Bracket'),
            expect.any(Number),
            expect.any(Number)
        );
    });
});
