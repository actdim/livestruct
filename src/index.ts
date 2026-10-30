/**
 * @actdim/livestruct
 * Ergonomic, reactive document and record abstraction over LiveStore (reactive SQLite & event-sourcing).
 */

import { createLiveEngine } from './engine/index';
import type { LiveCollection, LiveStoreInstance, LiveStructConfig } from './document/index';
import { LiveCollectionImpl } from './document/index';

export * from './engine/index';
export * from './lens/index';
export * from './document/index';

/**
 * Creates and initializes a LiveStruct store instance.
 *
 * @param config Store configuration
 * @returns Initialized store instance with collection access and low-level engine
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
        async collection<T extends object = Record<string, any>>(name: string): Promise<LiveCollection<T>> {
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
