export interface BrowserCadShape {
    id?: string;
    name?: string;
    x?: number;
    y?: number;
    [key: string]: unknown;
}

export interface BrowserCadDocData {
    shapes?: Record<string, BrowserCadShape>;
    selectedShapeId?: string | null;
    title?: string;
    [key: string]: unknown;
}

export interface BrowserCadStore {
    liveStore: {
        storageMode: string;
    };
    doc: {
        data: BrowserCadDocData;
        isTentative: boolean;
        patch: (patch: Record<string, unknown>) => Promise<void>;
        flush: () => Promise<void>;
    };
    updateShapeProperties: (shapeId: string, updates: Partial<BrowserCadShape>) => Promise<void>;
}

declare global {
    interface Window {
        __cadStore?: BrowserCadStore;
    }
}
