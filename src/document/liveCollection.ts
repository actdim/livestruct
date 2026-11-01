/**
 * @actdim/livestruct - LiveCollection Implementation
 * High-level collection management with document caching, CRUD operations,
 * and reactive query streams.
 */

import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import type { LiveEngineAccess, LiveSqliteEngine } from '../engine/index';
import type { LiveCollection, LiveDocument, LiveDocumentOptions } from './types';
import { LiveDocumentImpl } from './liveDocument';
import type { CommitScheduler } from './commitScheduler';
import type { OverlayChannel } from './overlayChannel';

export class LiveCollectionImpl<T extends object = Record<string, any>>
    implements LiveCollection<T>
{
    readonly name: string;
    private readonly rawEngine: LiveSqliteEngine;
    private readonly engineAccess: LiveEngineAccess<T>;
    private readonly commitScheduler?: CommitScheduler;
    private readonly overlayChannel?: OverlayChannel;
    private readonly options?: LiveDocumentOptions;
    private readonly documents = new Map<string, LiveDocumentImpl<T>>();
    private readonly querySubject = new BehaviorSubject<Array<LiveDocument<T>>>([]);
    private readonly cdcSubscription: Subscription;
    private isRefreshing = false;
    private pendingRefresh = false;
    private disposed = false;

    constructor(
        name: string,
        rawEngine: LiveSqliteEngine,
        commitScheduler?: CommitScheduler,
        overlayChannel?: OverlayChannel,
        options?: LiveDocumentOptions
    ) {
        this.name = name;
        this.rawEngine = rawEngine;
        this.commitScheduler = commitScheduler;
        this.overlayChannel = overlayChannel;
        this.options = options;
        this.engineAccess = rawEngine.getEngineAccess<T>(name);

        this.cdcSubscription = this.engineAccess.cdc$.subscribe((event) => {
            if (event.type === 'delete') {
                const cached = this.documents.get(event.id);
                if (cached) {
                    cached.dispose();
                    this.documents.delete(event.id);
                }
            }
            this.refreshQuery();
        });

        // Initial query population
        void this.refreshQuery();
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
        if (this.isRefreshing) {
            this.pendingRefresh = true;
            return;
        }
        this.isRefreshing = true;
        try {
            const allDocs = await this.find();
            if (!this.disposed) {
                this.querySubject.next(allDocs);
            }
        } finally {
            this.isRefreshing = false;
            if (this.pendingRefresh && !this.disposed) {
                this.pendingRefresh = false;
                void this.refreshQuery();
            }
        }
    }

    async get(id: string): Promise<LiveDocument<T> | null> {
        if (this.disposed) {
            throw new Error(`Cannot access disposed LiveCollection '${this.name}'.`);
        }

        const cached = this.documents.get(id);
        if (cached && !cached.isDisposed) {
            return cached;
        }

        const docRecord = await this.rawEngine.getDoc<T>(this.name, id);
        if (!docRecord) {
            return null;
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
            this.options
        );
        this.documents.set(id, doc);
        return doc;
    }

    async create(id: string, initialData: T): Promise<LiveDocument<T>> {
        if (this.disposed) {
            throw new Error(`Cannot access disposed LiveCollection '${this.name}'.`);
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
            this.options
        );
        this.documents.set(id, doc);
        await this.refreshQuery();
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
                    this.options
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
        this.querySubject.complete();
    }
}
