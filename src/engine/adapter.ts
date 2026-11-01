/**
 * Adapter resolution for LiveStore storage engines.
 * Selects OPFS persisted adapter in browser by default, single-tab when
 * SharedWorker is unavailable, and in-memory adapter in Node/tests or fallback.
 */

import {
    canUseSharedWorker,
    makeInMemoryAdapter,
    makePersistedAdapter,
    makeSingleTabAdapter,
} from '@livestore/adapter-web';
import type { Adapter } from '@livestore/livestore';
import type { EngineConfig } from './types';

export interface ResolvedLiveStoreConfig {
    readonly adapter: Adapter;
    readonly sessionId: string;
    readonly storageMode: 'persisted' | 'single-tab' | 'in-memory';
}

function generateSessionId(role = 'session'): string {
    const random = Math.random().toString(36).slice(2, 9);
    const time = Date.now().toString(36);
    return `${role}-${random}-${time}`;
}

/**
 * Resolves the LiveStore adapter and session identity based on runtime environment and config.
 */
export function resolveLiveStoreAdapter(config: EngineConfig): ResolvedLiveStoreConfig {
    const sessionId = config.sessionId || generateSessionId(config.name || 'session');

    // Force memory or Node/SSR environment: always use makeInMemoryAdapter
    const isNodeOrSsr = typeof window === 'undefined' || typeof navigator === 'undefined';
    if (config.forceMemory || config.storagePath === ':memory:' || isNodeOrSsr) {
        return {
            adapter: makeInMemoryAdapter(),
            sessionId,
            storageMode: 'in-memory',
        };
    }

    // Check OPFS availability in browser
    const hasOpfs = typeof navigator.storage?.getDirectory === 'function';
    if (!hasOpfs) {
        return {
            adapter: makeInMemoryAdapter(),
            sessionId,
            storageMode: 'in-memory',
        };
    }

    // SharedWorker support check
    const hasSharedWorker = canUseSharedWorker() && Boolean(config.sharedWorker);

    try {
        if (hasSharedWorker && config.worker && config.sharedWorker) {
            const adapter = makePersistedAdapter({
                storage: { type: 'opfs' },
                worker: config.worker as never,
                sharedWorker: config.sharedWorker as never,
                sessionId,
            });
            return {
                adapter,
                sessionId,
                storageMode: 'persisted',
            };
        }

        if (config.worker) {
            const adapter = makeSingleTabAdapter({
                storage: { type: 'opfs' },
                worker: config.worker as never,
                sessionId,
            });
            return {
                adapter,
                sessionId,
                storageMode: 'single-tab',
            };
        }
    } catch {
        // Fall back to in-memory if worker instantiation fails
    }

    return {
        adapter: makeInMemoryAdapter(),
        sessionId,
        storageMode: 'in-memory',
    };
}
