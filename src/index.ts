/**
 * @actdim/livestruct
 * Ergonomic, reactive document and record abstraction over LiveStore (reactive SQLite & event-sourcing).
 */

import { createLiveEngine } from './engine/index';
import type {
    LiveCollection,
    LiveDocumentOptions,
    LiveStoreInstance,
    LiveStructConfig,
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

    const commitScheduler = new CommitScheduler(engine as any, {
        commitPolicy: config.commitPolicy,
        commitDelayMs: config.commitDelayMs,
        maxCommitWaitMs: config.maxCommitWaitMs,
    });

    const overlayChannel = new OverlayChannel({
        storeId: config.name,
        sessionId: config.sessionId,
        overlayTtlMs: config.overlayTtlMs,
        disabled: config.disableOverlay,
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
        async collection<T extends object = Record<string, any>>(
            name: string,
            options?: LiveDocumentOptions
        ): Promise<LiveCollection<T>> {
            let col = collections.get(name);
            if (!col || col.isDisposed) {
                col = new LiveCollectionImpl<T>(name, engine, commitScheduler, overlayChannel, options);
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
