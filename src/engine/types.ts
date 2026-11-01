/**
 * Types and interfaces for the LiveStruct core engine and SQLite storage layer.
 */

import type { Observable } from 'rxjs';

export type StorageMode = 'opfs' | 'single-tab' | 'memory' | 'persisted' | 'in-memory';

export interface StorageAdapter {
    readonly mode: StorageMode;
    read(path: string): Promise<Uint8Array | null>;
    write(path: string, data: Uint8Array): Promise<void>;
    delete(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    close?(): Promise<void>;
}

export type BlobMap = Record<string, Uint8Array | Float32Array>;

export interface DocumentRecord<T extends object = Record<string, any>> {
    readonly collection: string;
    readonly id: string;
    readonly rev: number;
    readonly data: T;
    readonly blobs: BlobMap;
    readonly updatedAt: number;
}

export type CDCEventType = 'insert' | 'update' | 'delete';

export interface CDCEvent<T = unknown> {
    readonly type: CDCEventType;
    readonly kind?: CDCEventType;
    readonly collection: string;
    readonly id: string;
    readonly rev: number;
    readonly delta: Partial<T>;
    readonly data?: T;
    readonly timestamp: number;
    readonly mutationId?: string;
    readonly origin?: 'local' | 'remote' | 'migration' | string;
}

export interface RawCommitEvent<T = unknown> {
    readonly type: 'insert' | 'update' | 'patch' | 'delete';
    readonly collection: string;
    readonly id: string;
    readonly data?: Partial<T>;
    readonly blobs?: BlobMap;
    readonly rev?: number;
    readonly mutationId?: string;
    readonly origin?: string;
}

export interface EngineConfig {
    name: string;
    storagePath?: string;
    forceMemory?: boolean;
    sessionId?: string;
    disableDevtools?: boolean;
    confirmUnsavedChanges?: boolean;
    worker?: any;
    sharedWorker?: any;
}

export interface LiveEngineAccess<T = unknown> {
    readonly tableName: string;
    commitRaw(event: unknown): Promise<void>;
    queryRaw<R = unknown>(sql: string, params?: unknown[]): Promise<R[]>;
    readonly cdc$: Observable<{
        type: 'insert' | 'update' | 'delete';
        id: string;
        delta: Partial<T>;
        rev?: number;
        mutationId?: string;
        origin?: string;
        kind?: string;
        data?: T;
    }>;
}
