/**
 * @actdim/livestruct - LiveCollection Implementation
 * High-level collection management with document caching, in-flight load deduplication,
 * CRUD operations, subscription tracking, and reactive query streams.
 */

import { BehaviorSubject, Subject, Observable, Subscription } from 'rxjs';
import type { LiveEngineAccess, LiveDocEngine } from '../engine/index';
import type { LiveCollection, LiveDocument, LiveDocumentOptions, LiveStructEvent } from './types';
import { LiveDocumentImpl } from './liveDocument';
import type { CommitScheduler } from './commitScheduler';
import type { OverlayChannel } from './overlayChannel';
import { reportAsync } from './errors';
import { assertJsonSafe } from './patchHelper';

export class LiveCollectionImpl<T extends object = Record<string, unknown>>
    implements LiveCollection<T>
{
    readonly name: string;
    private readonly rawEngine: LiveDocEngine;
    private readonly engineAccess: LiveEngineAccess<T>;
    private readonly commitScheduler?: CommitScheduler;
    private readonly overlayChannel?: OverlayChannel;
    private readonly options?: LiveDocumentOptions;
    private readonly onEvent?: (event: LiveStructEvent) => void;
    private readonly allEvents$?: Observable<LiveStructEvent>;
    private readonly documents = new Map<string, LiveDocumentImpl<T>>();
    private readonly inFlightLoads = new Map<string, Promise<LiveDocument<T> | null>>();
    private readonly querySubject = new BehaviorSubject<Array<LiveDocument<T>>>([]);
    private readonly errorSubject = new Subject<Error>();
    private readonly cdcSubscription: Subscription;
    private activeRefreshPromise: Promise<void> | null = null;
    private pendingRefresh = false;
    private disposed = false;

    constructor(
        name: string,
        rawEngine: LiveDocEngine,
        commitScheduler?: CommitScheduler,
        overlayChannel?: OverlayChannel,
        options?: LiveDocumentOptions,
        onEvent?: (event: LiveStructEvent) => void,
        allEvents$?: Observable<LiveStructEvent>
    ) {
        this.name = name;
        this.rawEngine = rawEngine;
        this.commitScheduler = commitScheduler;
        this.overlayChannel = overlayChannel;
        this.options = options;
        this.onEvent = onEvent;
        this.allEvents$ = allEvents$;
        this.engineAccess = rawEngine.getEngineAccess<T>(name);

        this.cdcSubscription = this.engineAccess.cdc$.subscribe((event) => {
            if (event.type === 'delete') {
                const cached = this.documents.get(event.id);
                if (cached) {
                    cached.dispose();
                    this.documents.delete(event.id);
                }
            }
            reportAsync(
                this.refreshQuery(),
                'LiveCollection.cdc.refreshQuery',
                this.errorSubject
            );
        });

        // Initial query population safely tracked
        reportAsync(
            this.refreshQuery(),
            'LiveCollection.initial.refreshQuery',
            this.errorSubject
        );
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    get subscriptionCount(): number {
        if (this.disposed) {
            return 0;
        }
        let count = this.cdcSubscription.closed ? 0 : 1;
        for (const doc of this.documents.values()) {
            count += doc.subscriptionCount;
        }
        return count;
    }

    get query$(): Observable<Array<LiveDocument<T>>> {
        return this.querySubject.asObservable();
    }

    get errors$(): Observable<Error> {
        return this.errorSubject.asObservable();
    }

    private async refreshQuery(): Promise<void> {
        if (this.disposed) {
            return;
        }
        if (this.activeRefreshPromise) {
            this.pendingRefresh = true;
            await this.activeRefreshPromise;
            return;
        }

        this.activeRefreshPromise = (async () => {
            try {
                const allDocs = await this.find();
                if (!this.disposed) {
                    this.querySubject.next(allDocs);
                }
            } catch (err) {
                const errorObj = err instanceof Error ? err : new Error(String(err));
                this.errorSubject.next(errorObj);
            }
        })();

        try {
            await this.activeRefreshPromise;
        } finally {
            this.activeRefreshPromise = null;
            if (this.pendingRefresh && !this.disposed) {
                this.pendingRefresh = false;
                reportAsync(
                    this.refreshQuery(),
                    'LiveCollection.pending.refreshQuery',
                    this.errorSubject
                );
            }
        }
    }

    async get(id: string): Promise<LiveDocument<T> | null> {
        if (this.disposed) {
            throw new Error(`Cannot access disposed LiveCollection '${this.name}'.`);
        }

        const cached = this.documents.get(id);
        if (cached) {
            if (!cached.isDisposed) {
                return cached;
            }
            this.documents.delete(id);
        }

        const inFlight = this.inFlightLoads.get(id);
        if (inFlight) {
            const doc = await inFlight;
            if (doc && !doc.isDisposed) {
                return doc;
            }
            return null;
        }

        // Synchronously register in-flight promise before first await
        const loadPromise = (async () => {
            try {
                const docRecord = await this.rawEngine.getDoc<T>(this.name, id);
                if (!docRecord || this.disposed) {
                    return null;
                }

                const existing = this.documents.get(id);
                if (existing && !existing.isDisposed) {
                    return existing;
                }

                const doc = new LiveDocumentImpl<T>(
                    this.name,
                    id,
                    docRecord.data,
                    docRecord.rev,
                    this.rawEngine,
                    this.engineAccess,
                    this.commitScheduler,
                    this.overlayChannel,
                    this.options,
                    this.onEvent,
                    this.allEvents$
                );
                this.documents.set(id, doc);
                return doc;
            } finally {
                this.inFlightLoads.delete(id);
            }
        })();

        this.inFlightLoads.set(id, loadPromise);
        return loadPromise;
    }

    async create(id: string, initialData: T): Promise<LiveDocument<T>> {
        if (this.disposed) {
            throw new Error(`Cannot access disposed LiveCollection '${this.name}'.`);
        }

        assertJsonSafe(initialData);

        const cached = this.documents.get(id);
        if (cached && !cached.isDisposed) {
            throw new Error(
                `Document with id '${id}' already exists in collection '${this.name}'.`
            );
        }

        const docRecord = await this.rawEngine.insertDoc<T>(this.name, id, initialData);
        const doc = new LiveDocumentImpl<T>(
            this.name,
            id,
            docRecord.data,
            docRecord.rev,
            this.rawEngine,
            this.engineAccess,
            this.commitScheduler,
            this.overlayChannel,
            this.options,
            this.onEvent,
            this.allEvents$
        );
        this.documents.set(id, doc);
        await this.refreshQuery();
        return doc;
    }

    async delete(id: string): Promise<void> {
        if (this.disposed) {
            throw new Error(`Cannot access disposed LiveCollection '${this.name}'.`);
        }

        this.inFlightLoads.delete(id);
        const cached = this.documents.get(id);
        if (cached) {
            cached.dispose();
            this.documents.delete(id);
        }

        await this.rawEngine.deleteDoc(this.name, id);
        await this.refreshQuery();
    }

    async find(predicate?: (item: T) => boolean): Promise<Array<LiveDocument<T>>> {
        if (this.disposed) {
            throw new Error(`Cannot access disposed LiveCollection '${this.name}'.`);
        }

        const docRecords = await this.rawEngine.queryDocs<T>(
            this.name,
            (r) => (!predicate ? true : predicate(r.data))
        );

        if (!predicate) {
            const liveIds = new Set(docRecords.map((r) => r.id));
            for (const [id, doc] of this.documents.entries()) {
                if (!liveIds.has(id)) {
                    doc.dispose();
                    this.documents.delete(id);
                }
            }
        }

        const list: Array<LiveDocument<T>> = [];

        for (const record of docRecords) {
            let doc = this.documents.get(record.id);
            if (!doc || doc.isDisposed) {
                doc = new LiveDocumentImpl<T>(
                    this.name,
                    record.id,
                    record.data,
                    record.rev,
                    this.rawEngine,
                    this.engineAccess,
                    this.commitScheduler,
                    this.overlayChannel,
                    this.options,
                    this.onEvent,
                    this.allEvents$
                );
                this.documents.set(record.id, doc);
            }
            list.push(doc);
        }

        return list;
    }

    async flush(): Promise<void> {
        if (this.disposed) {
            return;
        }
        if (this.commitScheduler) {
            await this.commitScheduler.flushCollection(this.name);
        }
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
        this.inFlightLoads.clear();
        this.querySubject.complete();
        this.errorSubject.complete();
    }
}
