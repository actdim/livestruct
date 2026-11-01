/**
 * @actdim/livestruct - Document and Collection Types
 * High-level LiveDocument, LiveCollection, and reactive contracts.
 */

import type { Observable } from 'rxjs';
import type { LiveEngineAccess, LiveSqliteEngine } from '../engine/index';
import type { NestedPath, PathValue } from '../lens/index';

/**
 * Common disposable contract for documents, collections, and subscriptions.
 */
export interface Disposable {
    dispose(): void;
    readonly isDisposed: boolean;
}

/**
 * Partial update payload for RFC 7396 merge patch mutations.
 */
export type PatchPayload<T> = Partial<T> | Record<string, unknown>;

/**
 * High-level LiveDocument contract (RxDB-like ergonomics).
 */
export interface LiveDocument<T extends object = Record<string, any>> extends Disposable {
    readonly id: string;
    readonly collectionName: string;

    /**
     * Synchronous snapshot getter (immutable frozen POJO).
     */
    readonly data: Readonly<T>;

    /**
     * RxJS Observable stream emitting on any verified state change.
     */
    readonly $: Observable<Readonly<T>>;

    /**
     * Ergonomic partial mutation using RFC 7396 JSON merge patch.
     */
    patch(partial: PatchPayload<T>): Promise<void>;

    /**
     * Type-safe property path mutation leveraging lens.
     */
    patchPath<P extends NestedPath<T>>(path: P, value: PathValue<T, P>): Promise<void>;

    /**
     * Escape hatch to low-level SQLite and event-sourcing operations.
     */
    readonly engine: LiveEngineAccess<T>;
}

/**
 * High-level LiveCollection contract managing document instances and reactive queries.
 */
export interface LiveCollection<T extends object = Record<string, any>> extends Disposable {
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
    sessionId?: string;
    disableDevtools?: boolean;
    confirmUnsavedChanges?: boolean;
    worker?: any;
    sharedWorker?: any;
}

/**
 * High-level store instance providing collections and low-level engine.
 */
export interface LiveStoreInstance {
    readonly engine: LiveSqliteEngine;
    collection<T extends object = Record<string, any>>(name: string): Promise<LiveCollection<T>>;
    close(): Promise<void>;
}

/**
 * MobX-observable wrapper type for LiveDocument.
 */
export type ObservableLiveDocument<T extends object = Record<string, any>> = LiveDocument<T> & T;
