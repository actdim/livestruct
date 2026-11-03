export type CadShapeType = 'rect' | 'circle' | 'line';

export interface CadShape {
    id: string;
    type: CadShapeType;
    x: number;
    y: number;
    width?: number;
    height?: number;
    radius?: number;
    x2?: number;
    y2?: number;
    name?: string;
    layer?: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    rotation?: number;
}

export interface CadDocument {
    id: string;
    title: string;
    selectedShapeId?: string | null;
    shapes: Record<string, CadShape>;
    activeLayer?: string;
    metadata?: Record<string, unknown>;
}

export interface CursorDragPayload {
    shapeId: string;
    x: number;
    y: number;
    dx: number;
    dy: number;
    timestamp: number;
    senderId?: string;
}

export type CadMsgStruct = {
    'cad.cursor.drag': {
        in: CursorDragPayload;
    };
};

export const CAD_DRAG_CHANNEL = 'cad.cursor.drag' as const;

export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface TransformHandle {
    id: string;
    x: number;
    y: number;
    cursor: string;
}
