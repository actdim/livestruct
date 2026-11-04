import {
    createLiveStruct,
    type LiveCollection,
    type LiveDocument,
    type LiveStoreInstance,
    type LiveStructEvent,
} from '@actdim/livestruct';
import { createMsgBus } from '@actdim/msgmesh/core';
import type { MsgBus } from '@actdim/msgmesh/contracts';
import type { Subscription } from 'rxjs';
import type {
    CadDocument,
    CadMsgStruct,
    CadShape,
} from './types';

export {
    exportCadDatabase,
    downloadCadProject,
    importCadDatabase,
    buildSqliteCadDatabase,
    parseCadDatabase,
} from './exportImport';

export const DEFAULT_SHAPES: Record<string, CadShape> = {
    'rect-1': {
        id: 'rect-1',
        type: 'rect',
        x: 60,
        y: 60,
        width: 140,
        height: 90,
        name: 'Main Bracket',
        fill: '#3b82f6',
        stroke: '#60a5fa',
        strokeWidth: 2,
    },
    'circle-1': {
        id: 'circle-1',
        type: 'circle',
        x: 320,
        y: 120,
        radius: 45,
        name: 'Bearing Mount',
        fill: '#10b981',
        stroke: '#34d399',
        strokeWidth: 2,
    },
    'line-1': {
        id: 'line-1',
        type: 'line',
        x: 60,
        y: 240,
        x2: 360,
        y2: 240,
        name: 'Center Axis',
        stroke: '#f59e0b',
        strokeWidth: 3,
    },
};

export interface InitCadStoreOptions {
    name?: string;
    forceMemory?: boolean;
    sessionId?: string;
    bus?: MsgBus<CadMsgStruct>;
    initialShapes?: Record<string, CadShape>;
    senderId?: string;
}

export class CadStore {
    private _commits = 0;
    private _overlaysSent = 0;
    private _overlaysReceived = 0;
    private _patches = 0;
    private _undoStack: CadDocument[] = [];
    private _redoStack: CadDocument[] = [];
    private readonly _eventsSub?: Subscription;
    public readonly senderId: string;

    constructor(
        public readonly liveStore: LiveStoreInstance,
        public readonly collection: LiveCollection<CadDocument>,
        public readonly doc: LiveDocument<CadDocument>,
        public readonly bus: MsgBus<CadMsgStruct>,
        senderId?: string
    ) {
        this.senderId = senderId || 'peer_' + Math.random().toString(36).substring(2, 9);
        this._eventsSub = this.liveStore.events$?.subscribe((evt: LiveStructEvent) => {
            if (evt.type === 'commit') {
                this._commits++;
            } else if (evt.type === 'overlay_sent') {
                this._overlaysSent++;
            } else if (evt.type === 'overlay_received') {
                this._overlaysReceived++;
            } else if (evt.type === 'local_patch') {
                this._patches++;
            }
        });
    }

    get commits(): number {
        return this._commits;
    }

    get overlaysSent(): number {
        return this._overlaysSent;
    }

    get overlaysReceived(): number {
        return this._overlaysReceived;
    }

    get patches(): number {
        return this._patches;
    }

    get diskCommitCount(): number {
        return this._commits;
    }

    get canUndo(): boolean {
        return this._undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this._redoStack.length > 0;
    }

    public pushUndoSnapshot(): void {
        const snapshot = JSON.parse(JSON.stringify(this.doc.data)) as CadDocument;
        this._undoStack.push(snapshot);
        if (this._undoStack.length > 50) {
            this._undoStack.shift();
        }
        this._redoStack = [];
    }

    async undo(): Promise<boolean> {
        if (this._undoStack.length === 0) {
            return false;
        }
        const previous = this._undoStack.pop()!;
        const current = JSON.parse(JSON.stringify(this.doc.data)) as CadDocument;
        this._redoStack.push(current);

        await this.applySnapshot(previous);
        return true;
    }

    async redo(): Promise<boolean> {
        if (this._redoStack.length === 0) {
            return false;
        }
        const next = this._redoStack.pop()!;
        const current = JSON.parse(JSON.stringify(this.doc.data)) as CadDocument;
        this._undoStack.push(current);

        await this.applySnapshot(next);
        return true;
    }

    private async applySnapshot(target: CadDocument): Promise<void> {
        const patchPayload: Record<string, unknown> = {
            title: target.title,
            selectedShapeId: target.selectedShapeId ?? null,
            shapes: {},
        };
        const currentShapes = this.doc.data.shapes || {};
        const targetShapes = target.shapes || {};
        const shapesPatch: Record<string, unknown> = {};

        for (const k of Object.keys(currentShapes)) {
            if (!(k in targetShapes)) {
                shapesPatch[k] = null;
            }
        }
        for (const [k, v] of Object.entries(targetShapes)) {
            shapesPatch[k] = v;
        }
        patchPayload.shapes = shapesPatch;
        void this.doc.patch(patchPayload as Partial<CadDocument>);
        await this.doc.flush();
    }

    async commitShapeTransform(shapeId: string, updates: Partial<CadShape>): Promise<void> {
        this.pushUndoSnapshot();
        void this.doc.patch({
            shapes: {
                [shapeId]: updates,
            },
        });
        await this.doc.flush();
    }

    async selectShape(shapeId: string | null): Promise<void> {
        if (this.doc.data.selectedShapeId === shapeId) {
            return;
        }
        void this.doc.patch({
            selectedShapeId: shapeId,
        });
        await this.doc.flush();
    }

    async updateShapeProperties(shapeId: string, updates: Partial<CadShape>): Promise<void> {
        this.pushUndoSnapshot();
        void this.doc.patch({
            shapes: {
                [shapeId]: updates,
            },
        });
        await this.doc.flush();
    }

    async close(): Promise<void> {
        this._eventsSub?.unsubscribe();
        await this.liveStore.close();
    }
}

export async function initCadStore(options?: InitCadStoreOptions): Promise<CadStore> {
    const isNode = typeof window === 'undefined';
    const forceMemory = options?.forceMemory ?? isNode;
    const storeName = options?.name ?? 'cad_store';

    // Unique sessionId per context/iframe
    const sessionId =
        options?.sessionId ||
        (options?.senderId
            ? `session_${options.senderId.replace(/\s+/g, '_')}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
            : `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);

    let worker: any;
    let sharedWorker: any;

    if (!forceMemory && !isNode) {
        try {
            const workerMod = await import('../livestore/worker?worker');
            const sharedMod = await import('@livestore/adapter-web/shared-worker?sharedworker');
            worker = workerMod.default;
            sharedWorker = sharedMod.default;
        } catch {
            // Fallback for environments where worker constructors fail
        }
    }

    const liveStore = await createLiveStruct({
        name: storeName,
        forceMemory,
        sessionId,
        worker,
        sharedWorker,
    });

    const bus = options?.bus ?? createMsgBus<CadMsgStruct>();
    const collection = await liveStore.collection<CadDocument>('cad_documents');

    let doc = await collection.get('doc-default');
    if (!doc) {
        doc = await collection.create('doc-default', {
            id: 'doc-default',
            title: 'Mechanical Assembly',
            selectedShapeId: 'rect-1',
            shapes: options?.initialShapes ?? DEFAULT_SHAPES,
        });
    }

    return new CadStore(liveStore, collection, doc, bus, options?.senderId);
}
