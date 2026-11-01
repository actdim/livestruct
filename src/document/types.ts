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
 * Commit policy for document mutations.
 * - 'lazy': trailing debounce with max wait commit window (default).
 * - 'immediate': commits to SQLite immediately.
 */
export type CommitPolicy = 'lazy' | 'immediate';

/**
 * Diagnostic and reactive event types emitted across the LiveStruct engine.
 */
export type LiveStructEventType =
    | 'local_patch'
    | 'overlay_sent'
    | 'overlay_received'
    | 'commit'
    | 'remote_commit';

/**
 * Structured diagnostic event emitted by LiveStruct.
 */
export interface LiveStructEvent {
    readonly type: LiveStructEventType;
    readonly collection: string;
    readonly id: string;
    readonly timestamp: number;
    readonly rev?: number;
    readonly overlayId?: string;
    readonly senderSessionId?: string;
    readonly origin?: string;
    readonly patch?: Record<string, unknown>;
}

/**
 * Document and collection-level options for commit scheduling.
 */
export interface LiveDocumentOptions {
    commitPolicy?: CommitPolicy;
    commitDelayMs?: number;
    maxCommitWaitMs?: number;
}

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
     * Observable stream emitting deferred commit errors.
     */
    readonly errors$: Observable<Error>;

    /**
     * Observable stream of diagnostic lifecycle events for this document.
     */
    readonly events$: Observable<LiveStructEvent>;

    /**
     * True when there are local uncommitted pending patches.
     */
    readonly isPending: boolean;

    /**
     * True when viewing uncommitted tentative changes from another context.
     */
    readonly isTentative: boolean;

    /**
     * Ergonomic partial mutation using RFC 7396 JSON merge patch.
     * Updates doc.data, emits on doc.$ and MobX atom immediately.
     * Returned Promise resolves when committed to SQLite.
     */
    patch(partial: PatchPayload<T>): Promise<void>;

    /**
     * Type-safe property path mutation leveraging lens.
     */
    patchPath<P extends NestedPath<T>>(path: P, value: PathValue<T, P>): Promise<void>;

    /**
     * Flushes all pending uncommitted patches for this document immediately.
     */
    flush(): Promise<void>;

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

    /**
     * Flushes all pending uncommitted patches for documents in this collection.
     */
    flush(): Promise<void>;
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

    /**
     * Global commit policy (default: 'lazy').
     */
    commitPolicy?: CommitPolicy;

    /**
     * Trailing debounce commit delay in milliseconds (default: 150).
     */
    commitDelayMs?: number;

    /**
     * Maximum wait time before forcing a commit in milliseconds (default: 1000).
     */
    maxCommitWaitMs?: number;

    /**
     * Time-to-live for received tentative overlays without updates in ms (default: 1500).
     */
    overlayTtlMs?: number;

    /**
     * Set to true to disable BroadcastChannel tentative overlay sharing.
     */
    disableOverlay?: boolean;
}

/**
 * High-level store instance providing collections and low-level engine.
 */
export interface LiveStoreInstance {
    readonly engine: LiveSqliteEngine;
    readonly errors$: Observable<Error>;
    readonly events$: Observable<LiveStructEvent>;
    collection<T extends object = Record<string, any>>(
        name: string,
        options?: LiveDocumentOptions
    ): Promise<LiveCollection<T>>;
    flush(): Promise<void>;
    close(): Promise<void>;
}

/**
 * MobX-observable wrapper type for LiveDocument.
 */
export type ObservableLiveDocument<T extends object = Record<string, any>> = LiveDocument<T> & T;
