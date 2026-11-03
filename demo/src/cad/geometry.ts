import type { BoundingBox, CadShape, TransformHandle } from './types';

export function getBoundingBox(shape: CadShape): BoundingBox {
    if (shape.type === 'circle') {
        const r = shape.radius ?? 0;
        return {
            x: shape.x - r,
            y: shape.y - r,
            width: r * 2,
            height: r * 2,
        };
    }

    if (shape.type === 'line') {
        const x2 = shape.x2 ?? shape.x;
        const y2 = shape.y2 ?? shape.y;
        const minX = Math.min(shape.x, x2);
        const minY = Math.min(shape.y, y2);
        const maxX = Math.max(shape.x, x2);
        const maxY = Math.max(shape.y, y2);
        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
        };
    }

    // Default 'rect'
    const w = shape.width ?? 0;
    const h = shape.height ?? 0;
    const minX = w < 0 ? shape.x + w : shape.x;
    const minY = h < 0 ? shape.y + h : shape.y;
    return {
        x: minX,
        y: minY,
        width: Math.abs(w),
        height: Math.abs(h),
    };
}

export function pointToSegmentDistance(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) {
        return Math.hypot(px - x1, py - y1);
    }
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.hypot(px - projX, py - projY);
}

export function findTopmostHitShape(
    x: number,
    y: number,
    shapes: Record<string, CadShape>
): CadShape | null {
    const shapeList = Object.values(shapes).reverse();

    for (const shape of shapeList) {
        if (shape.type === 'circle') {
            const dx = x - shape.x;
            const dy = y - shape.y;
            const r = shape.radius ?? 0;
            if (dx * dx + dy * dy <= r * r) {
                return shape;
            }
        } else if (shape.type === 'line') {
            const x2 = shape.x2 ?? shape.x;
            const y2 = shape.y2 ?? shape.y;
            const dist = pointToSegmentDistance(x, y, shape.x, shape.y, x2, y2);
            const tolerance = Math.max(6, (shape.strokeWidth ?? 2) / 2 + 4);
            if (dist <= tolerance) {
                return shape;
            }
        } else {
            // rect
            const box = getBoundingBox(shape);
            if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
                return shape;
            }
        }
    }

    return null;
}

export function translateShape(shape: CadShape, dx: number, dy: number): CadShape {
    if (shape.type === 'line') {
        return {
            ...shape,
            x: shape.x + dx,
            y: shape.y + dy,
            x2: shape.x2 !== undefined ? shape.x2 + dx : undefined,
            y2: shape.y2 !== undefined ? shape.y2 + dy : undefined,
        };
    }

    return {
        ...shape,
        x: shape.x + dx,
        y: shape.y + dy,
    };
}

export function getTransformHandles(shape: CadShape): TransformHandle[] {
    const box = getBoundingBox(shape);
    return [
        { id: 'nw', x: box.x, y: box.y, cursor: 'nwse-resize' },
        { id: 'ne', x: box.x + box.width, y: box.y, cursor: 'nesw-resize' },
        { id: 'se', x: box.x + box.width, y: box.y + box.height, cursor: 'nwse-resize' },
        { id: 'sw', x: box.x, y: box.y + box.height, cursor: 'nesw-resize' },
    ];
}
