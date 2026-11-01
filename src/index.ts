/**
 * @actdim/livestruct
 * Ergonomic, reactive document and record abstraction over LiveStore (reactive SQLite & event-sourcing).
 */

import { Subject } from 'rxjs';
import { createLiveEngine } from './engine/index';
import type {
    LiveCollection,
    LiveDocumentOptions,
    LiveStoreInstance,
    LiveStructConfig,
    LiveStructEvent,
} from './document/index';
import {
    CommitScheduler,
    LiveCollectionImpl,
    OverlayChannel,
} from './document/index';

export * from './engine/index';
export * from './lens/index';
export * from './document/index';

/**
 * Creates and initializes a LiveStruct store instance.
 *
 * @param config Store configuration
 * @returns Initialized store instance with collection access, transparent lazy commits, and low-level engine
 */
export async function createLiveStruct(config: LiveStructConfig): Promise<LiveStoreInstance> {
    const engine = await createLiveEngine({
        name: config.name,
        storagePath: config.storagePath,
        forceMemory: config.forceMemory,
        sessionId: config.sessionId,
        disableDevtools: config.disableDevtools,
        confirmUnsavedChanges: config.confirmUnsavedChanges,
        worker: config.worker,
        sharedWorker: config.sharedWorker,
    });

    const eventsSubject = new Subject<LiveStructEvent>();
    const seenRemoteCommits = new Set<string>();

    const emitEvent = (event: LiveStructEvent) => {
        if (event.type === 'remote_commit') {
            const key = `${event.collection}:${event.id}:${event.rev ?? ''}:${event.overlayId ?? ''}`;
            if (seenRemoteCommits.has(key)) {
                return;
            }
            seenRemoteCommits.add(key);
            if (seenRemoteCommits.size > 200) {
                const first = seenRemoteCommits.values().next().value;
                if (first) {
                    seenRemoteCommits.delete(first);
                }
            }
        }
        eventsSubject.next(event);
    };

    const overlayChannel = new OverlayChannel({
        storeId: config.name,
        sessionId: config.sessionId,
        overlayTtlMs: config.overlayTtlMs,
        disabled: config.disableOverlay,
        onEvent: emitEvent,
    });

    const commitScheduler = new CommitScheduler(engine as any, {
        commitPolicy: config.commitPolicy,
        commitDelayMs: config.commitDelayMs,
        maxCommitWaitMs: config.maxCommitWaitMs,
        overlayChannel,
        onEvent: emitEvent,
    });

    const cdcSub = engine.cdc$.subscribe((event) => {
        if (event.origin === 'remote') {
            emitEvent({
                type: 'remote_commit',
                collection: event.collection,
                id: event.id,
                rev: event.rev,
                overlayId: event.overlayId,
                origin: event.origin,
                patch: event.delta as Record<string, unknown>,
                timestamp: event.timestamp || Date.now(),
            });
        }
    });

    const collections = new Map<string, LiveCollection<any>>();

    const onPageHide = () => {
        void commitScheduler.flushAll();
    };
    const onVisibilityChange = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            void commitScheduler.flushAll();
        }
    };

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('pagehide', onPageHide);
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return {
        engine,
        get errors$() {
            return commitScheduler.errors$;
        },
        get events$() {
            return eventsSubject.asObservable();
        },
        async collection<T extends object = Record<string, any>>(
            name: string,
            options?: LiveDocumentOptions
        ): Promise<LiveCollection<T>> {
            let col = collections.get(name);
            if (!col || col.isDisposed) {
                col = new LiveCollectionImpl<T>(
                    name,
                    engine,
                    commitScheduler,
                    overlayChannel,
                    options,
                    emitEvent,
                    eventsSubject.asObservable()
                );
                collections.set(name, col);
            }
            return col as LiveCollection<T>;
        },
        async flush(): Promise<void> {
            await commitScheduler.flushAll();
        },
        async close(): Promise<void> {
            if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
                window.removeEventListener('pagehide', onPageHide);
            }
            if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
                document.removeEventListener('visibilitychange', onVisibilityChange);
            }

            cdcSub.unsubscribe();
            eventsSubject.complete();
            await commitScheduler.flushAll();
            overlayChannel.dispose();
            commitScheduler.dispose();

            for (const col of collections.values()) {
                col.dispose();
            }
            collections.clear();
            await engine.close();
        },
    };
}
