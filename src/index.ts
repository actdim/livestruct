/**
 * @actdim/livestruct
 * Ergonomic, reactive document and record abstraction over LiveStore (reactive SQLite & event-sourcing).
 */

import { Observable } from 'rxjs';

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
 * Low-level engine access contract for CDC, raw SQLite, and event commitments.
 */
export interface LiveEngineAccess<T = unknown> {
    readonly tableName: string;
    commitRaw(event: unknown): Promise<void>;
    queryRaw<R = unknown>(sql: string, params?: unknown[]): Promise<R[]>;
    readonly cdc$: Observable<{ type: 'insert' | 'update' | 'delete'; id: string; delta: Partial<T> }>;
}

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
}

/**
 * Factory placeholder for creating a LiveStruct store instance.
 */
export async function createLiveStruct(config: LiveStructConfig): Promise<{
    collection<T extends Record<string, unknown>>(name: string): Promise<LiveCollection<T>>;
    close(): Promise<void>;
}> {
    // Scaffold implementation placeholder
    return {
        async collection<T extends Record<string, unknown>>(name: string): Promise<LiveCollection<T>> {
            throw new Error(`LiveStruct collection '${name}' initialization requires LiveStore driver.`);
        },
        async close(): Promise<void> {
            // Close placeholder
        },
    };
}
