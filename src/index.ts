/**
 * @actdim/livestruct
 * Ergonomic, reactive document and record abstraction over LiveStore (reactive SQLite & event-sourcing).
 */

import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import {
    createLiveEngine,
    LiveSqliteEngine,
    type StorageAdapter,
    type EngineConfig,
    type LiveEngineAccess,
    type DocumentRecord,
    type CDCEvent,
    type BlobMap,
} from './engine/index';

export * from './engine/index';

/**
 * Common disposable contract for documents and collections.
 */
export interface Disposable {
    dispose(): void;
    readonly isDisposed: boolean;
}

/**
 * Patch mutation payload for partial updates.
 */
export type PatchPayload<T> = Partial<T> | Record<string, unknown>;

/**
 * High-level LiveDocument contract (RxDB-like ergonomics).
 */
export interface LiveDocument<T extends Record<string, unknown> = Record<string, unknown>> extends Disposable {
    readonly id: string;
    readonly collectionName: string;

    /**
     * Synchronous snapshot getter.
     */
    readonly data: Readonly<T>;

    /**
     * RxJS Observable stream emitting on any verified state change.
     */
    readonly $: Observable<Readonly<T>>;

    /**
     * Ergonomic partial mutation (JSON-merge patch or atomic field update).
     */
    patch(partial: PatchPayload<T>): Promise<void>;

    /**
     * Escape hatch to low-level SQLite and event-sourcing operations.
     */
    readonly engine: LiveEngineAccess<T>;
}

/**
 * High-level LiveCollection contract.
 */
export interface LiveCollection<T extends Record<string, unknown> = Record<string, unknown>> extends Disposable {
    readonly name: string;
    get(id: string): Promise<LiveDocument<T> | null>;
    create(id: string, initialData: T): Promise<LiveDocument<T>>;
    delete(id: string): Promise<void>;
    find(predicate?: (item: T) => boolean): Promise<Array<LiveDocument<T>>>;
    readonly query$: Observable<Array<LiveDocument<T>>>;
}

/**
 * Core LiveStruct store configuration.
 */
export interface LiveStructConfig {
    name: string;
    storagePath?: string;
    forceMemory?: boolean;
}

class LiveDocumentImpl<T extends Record<string, unknown>> implements LiveDocument<T> {
    readonly id: string;
    readonly collectionName: string;
    readonly engine: LiveEngineAccess<T>;
    private readonly rawEngine: LiveSqliteEngine;
    private currentData: T;
    private currentRev: number;
    private readonly stateSubject: BehaviorSubject<Readonly<T>>;
    private readonly cdcSubscription: Subscription;
    private disposed = false;

    constructor(
        collectionName: string,
        id: string,
        initialData: T,
        initialRev: number,
        rawEngine: LiveSqliteEngine,
        engineAccess: LiveEngineAccess<T>
    ) {
        this.collectionName = collectionName;
        this.id = id;
        this.currentData = initialData;
        this.currentRev = initialRev;
        this.rawEngine = rawEngine;
        this.engine = engineAccess;
        this.stateSubject = new BehaviorSubject<Readonly<T>>(Object.freeze({ ...this.currentData }));

        // Subscribe to CDC events to sync internal state with echo suppression
        this.cdcSubscription = this.engine.cdc$
            .pipe(filter((event) => event.id === this.id))
            .subscribe((event) => {
                if (event.type === 'update' || event.type === 'insert') {
                    this.rawEngine.getDoc<T>(this.collectionName, this.id).then((doc) => {
                        if (doc && !this.disposed) {
                            this.applyUpdate(doc.rev, doc.data);
                        }
                    });
                }
            });
    }

    private applyUpdate(rev: number, data: T): void {
        if (rev <= this.currentRev) {
            return;
        }
        this.currentRev = rev;
        this.currentData = data;
        this.stateSubject.next(Object.freeze({ ...this.currentData }));
    }

    get data(): Readonly<T> {
        return this.currentData;
    }

    get $(): Observable<Readonly<T>> {
        return this.stateSubject.asObservable();
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    async patch(partial: PatchPayload<T>): Promise<void> {
        if (this.disposed) {
            throw new Error(`Cannot patch disposed LiveDocument '${this.id}'.`);
        }
        const updated = await this.rawEngine.patchDoc<T>(this.collectionName, this.id, partial);
        this.applyUpdate(updated.rev, updated.data);
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.cdcSubscription.unsubscribe();
        this.stateSubject.complete();
    }
}

class LiveCollectionImpl<T extends Record<string, unknown>> implements LiveCollection<T> {
    readonly name: string;
    private readonly rawEngine: LiveSqliteEngine;
    private readonly engineAccess: LiveEngineAccess<T>;
    private readonly documents = new Map<string, LiveDocumentImpl<T>>();
    private readonly querySubject = new BehaviorSubject<Array<LiveDocument<T>>>([]);
    private readonly cdcSubscription: Subscription;
    private disposed = false;

    constructor(name: string, rawEngine: LiveSqliteEngine) {
        this.name = name;
        this.rawEngine = rawEngine;
        this.engineAccess = rawEngine.getEngineAccess<T>(name);

        this.cdcSubscription = this.engineAccess.cdc$.subscribe(() => {
            this.refreshQuery();
        });
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    get query$(): Observable<Array<LiveDocument<T>>> {
        return this.querySubject.asObservable();
    }

    private async refreshQuery(): Promise<void> {
        if (this.disposed) {
            return;
        }
        const allDocs = await this.find();
        this.querySubject.next(allDocs);
    }

    async get(id: string): Promise<LiveDocument<T> | null> {
        if (this.disposed) {
            throw new Error(`Cannot access disposed LiveCollection '${this.name}'.`);
        }
        if (this.documents.has(id)) {
            const cached = this.documents.get(id)!;
            if (!cached.isDisposed) {
                return cached;
            }
        }

        const docRecord = await this.rawEngine.getDoc<T>(this.name, id);
        if (!docRecord) {
            return null;
        }

        const doc = new LiveDocumentImpl<T>(this.name, id, docRecord.data, docRecord.rev, this.rawEngine, this.engineAccess);
        this.documents.set(id, doc);
        return doc;
    }

    async create(id: string, initialData: T): Promise<LiveDocument<T>> {
        if (this.disposed) {
            throw new Error(`Cannot access disposed LiveCollection '${this.name}'.`);
        }
        const docRecord = await this.rawEngine.insertDoc<T>(this.name, id, initialData);
        const doc = new LiveDocumentImpl<T>(this.name, id, docRecord.data, docRecord.rev, this.rawEngine, this.engineAccess);
        this.documents.set(id, doc);
        this.refreshQuery();
        return doc;
    }

    async delete(id: string): Promise<void> {
        if (this.disposed) {
            throw new Error(`Cannot access disposed LiveCollection '${this.name}'.`);
        }
        const cached = this.documents.get(id);
        if (cached) {
            cached.dispose();
            this.documents.delete(id);
        }
        await this.rawEngine.deleteDoc(this.name, id);
        this.refreshQuery();
    }

    async find(predicate?: (item: T) => boolean): Promise<Array<LiveDocument<T>>> {
        if (this.disposed) {
            throw new Error(`Cannot access disposed LiveCollection '${this.name}'.`);
        }
        const docRecords = await this.rawEngine.queryDocs<T>(this.name, (r) => (!predicate ? true : predicate(r.data)));
        const list: Array<LiveDocument<T>> = [];

        for (const record of docRecords) {
            let doc = this.documents.get(record.id);
            if (!doc || doc.isDisposed) {
                doc = new LiveDocumentImpl<T>(this.name, record.id, record.data, record.rev, this.rawEngine, this.engineAccess);
                this.documents.set(record.id, doc);
            }
            list.push(doc);
        }

        return list;
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.cdcSubscription.unsubscribe();
        for (const doc of this.documents.values()) {
            doc.dispose();
        }
        this.documents.clear();
        this.querySubject.complete();
    }
}

export interface LiveStoreInstance {
    readonly engine: LiveSqliteEngine;
    collection<T extends Record<string, unknown>>(name: string): Promise<LiveCollection<T>>;
    close(): Promise<void>;
}

/**
 * Creates and initializes a LiveStruct store instance.
 */
export async function createLiveStruct(config: LiveStructConfig): Promise<LiveStoreInstance> {
    const engine = await createLiveEngine({
        name: config.name,
        storagePath: config.storagePath,
        forceMemory: config.forceMemory,
    });

    const collections = new Map<string, LiveCollection<any>>();

    return {
        engine,
        async collection<T extends Record<string, unknown>>(name: string): Promise<LiveCollection<T>> {
            let col = collections.get(name);
            if (!col || col.isDisposed) {
                col = new LiveCollectionImpl<T>(name, engine);
                collections.set(name, col);
            }
            return col as LiveCollection<T>;
        },
        async close(): Promise<void> {
            for (const col of collections.values()) {
                col.dispose();
            }
            collections.clear();
            await engine.close();
        },
    };
}
