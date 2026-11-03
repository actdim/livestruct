import { getBoundingBox, getTransformHandles, translateShape } from './geometry';
import type { CadShape, CursorDragPayload } from './types';

export function renderGrid(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    gridSize = 20,
    zoom = 1
): void {
    ctx.save();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;

    const step = gridSize * zoom;
    if (step <= 0) {
        ctx.restore();
        return;
    }

    ctx.beginPath();
    for (let x = 0; x <= width; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
    }
    ctx.stroke();
    ctx.restore();
}

export function renderSelectionBox(ctx: CanvasRenderingContext2D, shape: CadShape): void {
    const box = getBoundingBox(shape);
    const handles = getTransformHandles(shape);

    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(box.x - 2, box.y - 2, box.width + 4, box.height + 4);

    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 1.5;

    const handleSize = 6;
    for (const h of handles) {
        ctx.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
    }
    ctx.restore();
}

export function renderShape(
    ctx: CanvasRenderingContext2D,
    shape: CadShape,
    isSelected = false
): void {
    ctx.save();

    if (shape.rotation) {
        const box = getBoundingBox(shape);
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((shape.rotation * Math.PI) / 180);
        ctx.translate(-cx, -cy);
    }

    const fill = shape.fill ?? '#3b82f6';
    const stroke = shape.stroke ?? '#60a5fa';
    const strokeWidth = shape.strokeWidth ?? 2;

    if (shape.type === 'rect') {
        const box = getBoundingBox(shape);
        if (fill !== 'transparent') {
            ctx.fillStyle = fill;
            ctx.fillRect(box.x, box.y, box.width, box.height);
        }
        if (stroke !== 'transparent') {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = strokeWidth;
            ctx.strokeRect(box.x, box.y, box.width, box.height);
        }
    } else if (shape.type === 'circle') {
        const r = shape.radius ?? 25;
        ctx.beginPath();
        ctx.arc(shape.x, shape.y, r, 0, Math.PI * 2);
        if (fill !== 'transparent') {
            ctx.fillStyle = fill;
            ctx.fill();
        }
        if (stroke !== 'transparent') {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = strokeWidth;
            ctx.stroke();
        }
    } else if (shape.type === 'line') {
        const x2 = shape.x2 ?? shape.x;
        const y2 = shape.y2 ?? shape.y;
        if (stroke !== 'transparent') {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = strokeWidth;
            ctx.beginPath();
            ctx.moveTo(shape.x, shape.y);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }
    }

    if (isSelected) {
        renderSelectionBox(ctx, shape);
    }

    ctx.restore();
}

export function renderRemotePreview(
    ctx: CanvasRenderingContext2D,
    shape: CadShape,
    dragPayload: CursorDragPayload
): void {
    ctx.save();
    ctx.globalAlpha = 0.5;

    const ghostShape = translateShape(shape, dragPayload.dx, dragPayload.dy);
    renderShape(ctx, ghostShape, false);

    const box = getBoundingBox(ghostShape);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#f59e0b';
    ctx.font = '11px monospace';
    ctx.fillText('Remote Drag: ' + (shape.name ?? dragPayload.shapeId), box.x, box.y - 6);

    ctx.restore();
}

export function renderGhostShape(
    ctx: CanvasRenderingContext2D,
    shape: CadShape,
    isSelected = false
): void {
    ctx.save();
    ctx.globalAlpha = 0.55;
    renderShape(ctx, shape, isSelected);

    const box = getBoundingBox(shape);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#f59e0b';
    ctx.font = '11px monospace';
    ctx.fillText('[Tentative Remote] ' + (shape.name ?? shape.id), box.x, box.y - 6);

    ctx.restore();
}
