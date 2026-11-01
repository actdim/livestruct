/**
 * LiveStore-backed document storage engine for LiveStruct.
 * Replaces the legacy Map/JSON write path with real reactive SQLite WASM,
 * leader worker synchronization, built-in schema, and content-addressed blobs.
 */

import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { createStorePromise } from '@livestore/livestore';
import type {
    DocumentRecord,
    CDCEvent,
    RawCommitEvent,
    EngineConfig,
    LiveEngineAccess,
    BlobMap,
    StorageAdapter,
} from './types';
import { jsonMergePatch } from './patch';
import { schema, tables, events, makeDocKey } from './schema';
import { resolveLiveStoreAdapter } from './adapter';
import { resolveBlobStore, type BlobStore } from './blobStore';
import { migrateLegacyV1 } from './migrateV1';
import { MemoryStorageAdapter } from './storage';
import { deepFreeze } from '../document/deepFreeze';
import { setAtPath, toSqliteJsonPath } from '../document/patchHelper';

export class LiveDocEngine {
    readonly config: EngineConfig;
    store: any;
    readonly blobStore: BlobStore;
    readonly storage: StorageAdapter;
    private readonly cdcSubject = new Subject<CDCEvent<any>>();
    private readonly localMutationIds = new Set<string>();
    private readonly localKnownDocs = new Map<string, { rev: number; data: any; blobs: BlobMap }>();
    private _isClosed = false;
    private unsubscribeTable?: () => void;
    private isInitialized = false;

    get isClosed(): boolean {
        return this._isClosed;
    }

    get storageMode(): string {
        return this.store?.storageMode || this.storage?.mode || 'in-memory';
    }

    get cdc$(): Observable<CDCEvent<any>> {
        return this.cdcSubject.asObservable();
    }

    get subscriptionCount(): number {
        return (this.cdcSubject as any).observers ? (this.cdcSubject as any).observers.length : 0;
    }

    constructor(config: EngineConfig, storeOrStorage?: any, blobStore?: BlobStore) {
        this.config = config;

        if (storeOrStorage && (typeof storeOrStorage.read === 'function' || storeOrStorage.mode)) {
            // Legacy StorageAdapter passed as 2nd argument
            this.storage = storeOrStorage;
            this.store = null;
            this.blobStore = blobStore || resolveBlobStore(config.forceMemory || true);
        } else {
            this.store = storeOrStorage;
            this.blobStore = blobStore || resolveBlobStore(config.forceMemory);
            this.storage = new MemoryStorageAdapter();
        }
    }

    /**
     * Initializes the engine, sets up subscriptions, and syncs initial table state.
     */
    async init(): Promise<this> {
        if (!this.store) {
            const resolved = resolveLiveStoreAdapter(this.config);
            this.store = await createStorePromise({
                schema,
                storeId: this.config.name || 'default',
                adapter: resolved.adapter,
                confirmUnsavedChanges: this.config.confirmUnsavedChanges ?? false,
                disableDevtools: this.config.disableDevtools ?? true,
            });
        }

        // Migrate any legacy v1 JSON database if present in storage
        if (this.storage) {
            await migrateLegacyV1(this.config, this.store, this.blobStore, this.storage);
        }

        // Read existing rows to seed localKnownDocs without firing CDC
        try {
            const initialRows = this.store.query(tables.docs);
            if (Array.isArray(initialRows)) {
                for (const row of initialRows) {
                    try {
                        const data = JSON.parse(row.body);
                        this.localKnownDocs.set(row.key, {
                            rev: row.rev,
                            data,
                            blobs: {},
                        });
                    } catch {
                        // Ignore malformed rows
                    }
                }
            }
        } catch {
            // Ignore query errors during initial seed
        }

        this.isInitialized = true;

        // Reactive table subscription for background sync and remote CDC
        this.unsubscribeTable = this.store.subscribe(tables.docs, (rows: any[]) => {
            if (this._isClosed || !this.isInitialized) {
                return;
            }

            const currentKeys = new Set<string>();

            for (const row of rows) {
                const key = row.key;
                currentKeys.add(key);

                // If this mutation originated locally on this engine instance, skip
                if (row.mutationId && this.localMutationIds.has(row.mutationId)) {
                    continue;
                }

                const known = this.localKnownDocs.get(key);
                if (!known) {
                    // Remote insert
                    try {
                        const data = JSON.parse(row.body);
                        this.localKnownDocs.set(key, { rev: row.rev, data, blobs: {} });
                        this.cdcSubject.next({
                            type: 'insert',
                            kind: 'insert',
                            collection: row.collection,
                            id: row.id,
                            rev: row.rev,
                            delta: data,
                            data,
                            timestamp: row.updatedAt,
                            mutationId: row.mutationId,
                            overlayId: row.overlayId || row.mutationId,
                            origin: 'remote',
                        });
                    } catch {
                        // Ignore parse errors
                    }
                } else if (row.rev > known.rev) {
                    // Remote update
                    try {
                        const data = JSON.parse(row.body);
                        this.localKnownDocs.set(key, { rev: row.rev, data, blobs: {} });
                        this.cdcSubject.next({
                            type: 'update',
                            kind: 'update',
                            collection: row.collection,
                            id: row.id,
                            rev: row.rev,
                            delta: data,
                            data,
                            timestamp: row.updatedAt,
                            mutationId: row.mutationId,
                            overlayId: row.overlayId || row.mutationId,
                            origin: 'remote',
                        });
                    } catch {
                        // Ignore parse errors
                    }
                }
            }

            // Detect remote deletes
            for (const [key, known] of this.localKnownDocs.entries()) {
                if (!currentKeys.has(key)) {
                    this.localKnownDocs.delete(key);
                    const sep = key.indexOf('\u0001');
                    const collection = sep !== -1 ? key.slice(0, sep) : '';
                    const id = sep !== -1 ? key.slice(sep + 1) : key;
                    this.cdcSubject.next({
                        type: 'delete',
                        kind: 'delete',
                        collection,
                        id,
                        rev: known.rev + 1,
                        delta: {},
                        data: undefined,
                        timestamp: Date.now(),
                        origin: 'remote',
                    });
                }
            }
        });

        return this;
    }

    /**
     * Inserts a new document. Throws if a document with the same collection and id already exists.
     */
    async insertDoc<T extends object = Record<string, any>>(
        collection: string,
        id: string,
        data: T,
        blobs?: BlobMap,
        mutationId?: string
    ): Promise<DocumentRecord<T>> {
        this.assertNotClosed();
        const key = makeDocKey(collection, id);

        // Check uniqueness synchronously
        const existing = this.store.query({
            query: 'SELECT rev FROM docs WHERE key = ?',
            bindValues: [key],
        });
        if (existing && existing.length > 0) {
            throw new Error(`Document with id '${id}' already exists in collection '${collection}'.`);
        }

        const now = Date.now();
        const hasExplicitMutationId = mutationId !== undefined;
        const mutId = mutationId || `mut_${id}_${now}_${Math.random().toString(36).slice(2, 7)}`;
        this.localMutationIds.add(mutId);

        // Store blobs in content-addressed BlobStore
        const blobHashes: Record<string, string> = {};
        if (blobs) {
            for (const [bName, bData] of Object.entries(blobs)) {
                if (bData) {
                    blobHashes[bName] = await this.blobStore.put(bData);
                }
            }
        }

        const clonedData = deepFreeze(structuredClone(jsonMergePatch<T>({} as T, data)));
        const doc: DocumentRecord<T> = {
            collection,
            id,
            rev: 1,
            data: clonedData,
            blobs: blobs ? { ...blobs } : {},
            updatedAt: now,
        };

        this.localKnownDocs.set(key, { rev: 1, data: clonedData, blobs: doc.blobs });

        // Commit event to LiveStore
        this.store.commit(
            events.DocInserted({
                collection,
                id,
                data: JSON.stringify(clonedData),
                blobs: Object.keys(blobHashes).length > 0 ? JSON.stringify(blobHashes) : '{}',
                mutationId: mutId,
                origin: 'local',
                updatedAt: now,
            })
        );

        // Emit local CDC synchronously
        this.cdcSubject.next({
            type: 'insert',
            kind: 'insert',
            collection,
            id,
            rev: 1,
            delta: deepFreeze(structuredClone(clonedData)),
            data: clonedData,
            timestamp: now,
            mutationId: hasExplicitMutationId ? mutId : undefined,
            origin: 'local',
        });

        return doc;
    }

    /**
     * Replaces an existing document or creates it if missing.
     */
    async updateDoc<T extends object = Record<string, any>>(
        collection: string,
        id: string,
        data: T,
        blobs?: BlobMap,
        mutationId?: string
    ): Promise<DocumentRecord<T>> {
        this.assertNotClosed();
        const key = makeDocKey(collection, id);

        const existingRows = this.store.query({
            query: 'SELECT rev, body, blobs FROM docs WHERE key = ?',
            bindValues: [key],
        });
        const existing = existingRows && existingRows.length > 0 ? existingRows[0] : null;

        const now = Date.now();
        const rev = existing ? existing.rev + 1 : 1;
        const hasExplicitMutationId = mutationId !== undefined;
        const mutId = mutationId || `mut_${id}_${now}_${Math.random().toString(36).slice(2, 7)}`;
        this.localMutationIds.add(mutId);

        // Process blobs
        const blobHashes: Record<string, string> = {};
        if (existing?.blobs && existing.blobs !== '{}') {
            try {
                Object.assign(blobHashes, JSON.parse(existing.blobs));
            } catch {
                // Ignore parse errors
            }
        }
        if (blobs) {
            for (const [bName, bData] of Object.entries(blobs)) {
                if (bData) {
                    blobHashes[bName] = await this.blobStore.put(bData);
                }
            }
        }

        const clonedData = deepFreeze(structuredClone(jsonMergePatch<T>({} as T, data)));
        const doc: DocumentRecord<T> = {
            collection,
            id,
            rev,
            data: clonedData,
            blobs: blobs ? { ...blobs } : {},
            updatedAt: now,
        };

        this.localKnownDocs.set(key, { rev, data: clonedData, blobs: doc.blobs });

        this.store.commit(
            events.DocReplaced({
                collection,
                id,
                data: JSON.stringify(clonedData),
                blobs: Object.keys(blobHashes).length > 0 ? JSON.stringify(blobHashes) : '{}',
                mutationId: mutId,
                origin: 'local',
                updatedAt: now,
            })
        );

        this.cdcSubject.next({
            type: existing ? 'update' : 'insert',
            kind: existing ? 'replace' : 'insert',
            collection,
            id,
            rev,
            delta: deepFreeze(structuredClone(clonedData)),
            data: clonedData,
            timestamp: now,
            mutationId: hasExplicitMutationId ? mutId : undefined,
            origin: 'local',
        });

        return doc;
    }

    /**
     * Applies an RFC 7396 JSON merge patch atomically to an existing document.
     */
    async patchDoc<T extends object = Record<string, any>>(
        collection: string,
        id: string,
        patch: Partial<T> | Record<string, unknown>,
        blobs?: BlobMap,
        mutationId?: string
    ): Promise<DocumentRecord<T>> {
        this.assertNotClosed();
        const key = makeDocKey(collection, id);

        const rows = this.store.query({
            query: 'SELECT rev, body, blobs FROM docs WHERE key = ?',
            bindValues: [key],
        });
        if (!rows || rows.length === 0) {
            throw new Error(`Document with id '${id}' not found in collection '${collection}'.`);
        }

        const existingRow = rows[0];
        const existingData = JSON.parse(existingRow.body);
        const patchedData = deepFreeze(structuredClone(jsonMergePatch<T>(existingData, patch)));
        const now = Date.now();
        const rev = existingRow.rev + 1;
        const hasExplicitMutationId = mutationId !== undefined;
        const mutId = mutationId || `mut_${id}_${now}_${Math.random().toString(36).slice(2, 7)}`;
        this.localMutationIds.add(mutId);

        let blobHashesString: string | undefined;
        if (blobs) {
            const blobHashes: Record<string, string> = {};
            if (existingRow.blobs && existingRow.blobs !== '{}') {
                try {
                    Object.assign(blobHashes, JSON.parse(existingRow.blobs));
                } catch {
                    // Ignore
                }
            }
            for (const [bName, bData] of Object.entries(blobs)) {
                if (bData) {
                    blobHashes[bName] = await this.blobStore.put(bData);
                }
            }
            blobHashesString = JSON.stringify(blobHashes);
        }

        const doc: DocumentRecord<T> = {
            collection,
            id,
            rev,
            data: patchedData,
            blobs: blobs ? { ...blobs } : {},
            updatedAt: now,
        };

        this.localKnownDocs.set(key, { rev, data: patchedData, blobs: doc.blobs });

        this.store.commit(
            events.DocPatched({
                collection,
                id,
                patch: JSON.stringify(patch),
                blobs: blobHashesString,
                mutationId: mutId,
                overlayId: mutId,
                origin: 'local',
                updatedAt: now,
            })
        );

        this.cdcSubject.next({
            type: 'update',
            kind: 'update',
            collection,
            id,
            rev,
            delta: deepFreeze(structuredClone(patch as Partial<T>)),
            data: patchedData,
            timestamp: now,
            mutationId: hasExplicitMutationId ? mutId : undefined,
            overlayId: hasExplicitMutationId ? mutId : undefined,
            origin: 'local',
        });

        return doc;
    }

    /**
     * Sets a nested property path using SQLite json_set with SET semantics (DocPathSet).
     */
    async setPathDoc<T extends object = Record<string, any>>(
        collection: string,
        id: string,
        path: string,
        value: unknown,
        mutationId?: string
    ): Promise<DocumentRecord<T>> {
        this.assertNotClosed();
        const key = makeDocKey(collection, id);

        const rows = this.store.query({
            query: 'SELECT rev, body, blobs FROM docs WHERE key = ?',
            bindValues: [key],
        });
        if (!rows || rows.length === 0) {
            throw new Error(`Document with id '${id}' not found in collection '${collection}'.`);
        }

        const existingRow = rows[0];
        const existingData = JSON.parse(existingRow.body);
        const updatedData = deepFreeze(structuredClone(setAtPath(existingData, path, value))) as T;
        const now = Date.now();
        const rev = existingRow.rev + 1;
        const hasExplicitMutationId = mutationId !== undefined;
        const mutId = mutationId || `mut_${id}_${now}_${Math.random().toString(36).slice(2, 7)}`;
        this.localMutationIds.add(mutId);

        const sqlitePath = toSqliteJsonPath(path);
        const serializedValue = JSON.stringify(value);

        const doc: DocumentRecord<T> = {
            collection,
            id,
            rev,
            data: updatedData,
            blobs: {},
            updatedAt: now,
        };

        this.localKnownDocs.set(key, { rev, data: updatedData, blobs: doc.blobs });

        this.store.commit(
            events.DocPathSet({
                collection,
                id,
                path: sqlitePath,
                value: serializedValue,
                mutationId: mutId,
                overlayId: mutId,
                origin: 'local',
                updatedAt: now,
            })
        );

        const rootProp = path.split('.')[0];
        const delta = deepFreeze(structuredClone({ [rootProp]: (updatedData as any)[rootProp] })) as Partial<T>;

        this.cdcSubject.next({
            type: 'update',
            kind: 'update',
            collection,
            id,
            rev,
            delta,
            data: updatedData,
            timestamp: now,
            mutationId: hasExplicitMutationId ? mutId : undefined,
            overlayId: hasExplicitMutationId ? mutId : undefined,
            origin: 'local',
        });

        return doc;
    }

    /**
     * Emits a CDC event directly on the engine CDC subject.
     */
    emitCDC(event: CDCEvent<any>): void {
        this.cdcSubject.next(event);
    }

    /**
     * Commits a batch of RFC 7396 merge patches or path-set operations in a single atomic SQLite commit.
     */
    async commitBatchedPatches(
        entries: Array<{
            collection: string;
            id: string;
            patch?: Record<string, unknown>;
            pathSet?: { path: string; value: unknown };
            pathSets?: Array<{ path: string; value: unknown }>;
            blobs?: BlobMap;
            mutationId?: string;
            overlayId?: string;
            emitCDC?: boolean;
        }>
    ): Promise<Array<DocumentRecord<any>>> {
        this.assertNotClosed();
        if (entries.length === 0) {
            return [];
        }

        const now = Date.now();
        const results: Array<DocumentRecord<any>> = [];
        const commitEvents: any[] = [];
        const cdcToEmit: Array<CDCEvent<any>> = [];

        for (const entry of entries) {
            const { collection, id, patch, pathSet, pathSets, blobs, mutationId, overlayId, emitCDC } = entry;
            const key = makeDocKey(collection, id);

            const rows = this.store.query({
                query: 'SELECT rev, body, blobs FROM docs WHERE key = ?',
                bindValues: [key],
            });
            if (!rows || rows.length === 0) {
                throw new Error(`Document with id '${id}' not found in collection '${collection}'.`);
            }

            const existingRow = rows[0];
            const existingData = JSON.parse(existingRow.body);
            let patchedData = existingData;

            if (patch) {
                patchedData = jsonMergePatch<any>(patchedData, patch);
            }

            const allPathSets = pathSets ?? (pathSet ? [pathSet] : []);
            for (const ps of allPathSets) {
                patchedData = setAtPath(patchedData, ps.path, ps.value);
            }

            patchedData = deepFreeze(structuredClone(patchedData));
            const rev = existingRow.rev + 1;
            const mutId = mutationId || overlayId || `mut_${id}_${now}_${Math.random().toString(36).slice(2, 7)}`;
            this.localMutationIds.add(mutId);

            let blobHashesString: string | undefined;
            if (blobs) {
                const blobHashes: Record<string, string> = {};
                if (existingRow.blobs && existingRow.blobs !== '{}') {
                    try {
                        Object.assign(blobHashes, JSON.parse(existingRow.blobs));
                    } catch {
                        // Ignore
                    }
                }
                for (const [bName, bData] of Object.entries(blobs)) {
                    if (bData) {
                        blobHashes[bName] = await this.blobStore.put(bData);
                    }
                }
                blobHashesString = JSON.stringify(blobHashes);
            }

            const doc: DocumentRecord<any> = {
                collection,
                id,
                rev,
                data: patchedData,
                blobs: blobs ? { ...blobs } : {},
                updatedAt: now,
            };

            this.localKnownDocs.set(key, { rev, data: patchedData, blobs: doc.blobs });
            results.push(doc);

            if (patch) {
                commitEvents.push(
                    events.DocPatched({
                        collection,
                        id,
                        patch: JSON.stringify(patch),
                        blobs: blobHashesString,
                        mutationId: mutId,
                        overlayId: overlayId ?? mutId,
                        origin: 'local',
                        updatedAt: now,
                    })
                );
            }

            for (const ps of allPathSets) {
                commitEvents.push(
                    events.DocPathSet({
                        collection,
                        id,
                        path: toSqliteJsonPath(ps.path),
                        value: JSON.stringify(ps.value),
                        mutationId: mutId,
                        overlayId: overlayId ?? mutId,
                        origin: 'local',
                        updatedAt: now,
                    })
                );
            }

            if (emitCDC) {
                const deltaPayload = patch ?? (allPathSets.length > 0 ? { [allPathSets[0].path.split('.')[0]]: (patchedData as any)[allPathSets[0].path.split('.')[0]] } : {});
                cdcToEmit.push({
                    type: 'update',
                    kind: 'update',
                    collection,
                    id,
                    rev,
                    delta: deepFreeze(structuredClone(deltaPayload)),
                    data: patchedData,
                    timestamp: now,
                    mutationId: mutId,
                    overlayId: overlayId ?? mutId,
                    origin: 'local',
                });
            }
        }

        this.store.commit(...commitEvents);

        for (const cdc of cdcToEmit) {
            this.cdcSubject.next(cdc);
        }

        return results;
    }

    /**
     * Deletes a document by id.
     */
    async deleteDoc(collection: string, id: string, mutationId?: string): Promise<boolean> {
        this.assertNotClosed();
        const key = makeDocKey(collection, id);

        const rows = this.store.query({
            query: 'SELECT rev FROM docs WHERE key = ?',
            bindValues: [key],
        });
        if (!rows || rows.length === 0) {
            return false;
        }

        const existingRev = rows[0].rev;
        const now = Date.now();
        const hasExplicitMutationId = mutationId !== undefined;
        const mutId = mutationId || `mut_${id}_${now}_${Math.random().toString(36).slice(2, 7)}`;
        this.localMutationIds.add(mutId);

        this.localKnownDocs.delete(key);

        this.store.commit(
            events.DocDeleted({
                collection,
                id,
                mutationId: mutId,
                origin: 'local',
                updatedAt: now,
            })
        );

        this.cdcSubject.next({
            type: 'delete',
            kind: 'delete',
            collection,
            id,
            rev: existingRev + 1,
            delta: {},
            data: undefined,
            timestamp: now,
            mutationId: hasExplicitMutationId ? mutId : undefined,
            origin: 'local',
        });

        return true;
    }

    /**
     * Gets a document snapshot by id, rehydrating binary blobs from BlobStore.
     */
    async getDoc<T extends object = Record<string, any>>(
        collection: string,
        id: string
    ): Promise<DocumentRecord<T> | null> {
        this.assertNotClosed();
        const key = makeDocKey(collection, id);

        const rows = this.store.query({
            query: 'SELECT rev, body, blobs, updatedAt FROM docs WHERE key = ?',
            bindValues: [key],
        });
        if (!rows || rows.length === 0) {
            return null;
        }

        const row = rows[0];
        let data: T;
        const known = this.localKnownDocs.get(key);
        if (known && known.rev === row.rev) {
            data = known.data;
        } else {
            data = deepFreeze(structuredClone(JSON.parse(row.body) as T));
            this.localKnownDocs.set(key, { rev: row.rev, data, blobs: known?.blobs ?? {} });
        }
        const blobs: BlobMap = {};

        if (row.blobs && row.blobs !== '{}') {
            try {
                const hashes = JSON.parse(row.blobs) as Record<string, string>;
                for (const [bName, bHash] of Object.entries(hashes)) {
                    const loaded = await this.blobStore.get(bHash);
                    if (loaded) {
                        blobs[bName] = loaded;
                    }
                }
            } catch {
                // Ignore parse errors
            }
        }

        return {
            collection,
            id,
            rev: row.rev,
            data,
            blobs,
            updatedAt: row.updatedAt,
        };
    }

    /**
     * Queries all documents in a collection, optionally filtered by predicate.
     */
    async queryDocs<T extends object = Record<string, any>>(
        collection: string,
        predicate?: (doc: DocumentRecord<T>) => boolean
    ): Promise<Array<DocumentRecord<T>>> {
        this.assertNotClosed();
        const rows = this.store.query({
            query: 'SELECT id, rev, body, blobs, updatedAt FROM docs WHERE collection = ?',
            bindValues: [collection],
        });

        const results: Array<DocumentRecord<T>> = [];
        if (!rows) {
            return results;
        }

        for (const row of rows) {
            const key = makeDocKey(collection, row.id);
            let data: T;
            const known = this.localKnownDocs.get(key);
            if (known && known.rev === row.rev) {
                data = known.data;
            } else {
                data = deepFreeze(structuredClone(JSON.parse(row.body) as T));
                this.localKnownDocs.set(key, { rev: row.rev, data, blobs: {} });
            }
            const doc: DocumentRecord<T> = {
                collection,
                id: row.id,
                rev: row.rev,
                data,
                blobs: {},
                updatedAt: row.updatedAt,
            };

            if (!predicate || predicate(doc)) {
                results.push(doc);
            }
        }

        return results;
    }

    /**
     * Obtains LiveEngineAccess instance for a specific collection.
     */
    getEngineAccess<T = unknown>(collection: string): LiveEngineAccess<T> {
        const cdc$ = this.cdcSubject.pipe(
            filter((event) => event.collection === collection),
            map((event) => {
                const res: {
                    type: 'insert' | 'update' | 'delete';
                    id: string;
                    delta: Partial<T>;
                    mutationId?: string;
                    overlayId?: string;
                } = {
                    type: event.type,
                    id: event.id,
                    delta: event.delta as Partial<T>,
                };
                if (event.mutationId !== undefined) {
                    res.mutationId = event.mutationId;
                }
                if (event.overlayId !== undefined) {
                    res.overlayId = event.overlayId;
                }
                return res;
            })
        );

        return {
            tableName: collection,
            commitRaw: async (event: unknown) => {
                await this.commitRaw(event, collection);
            },
            queryRaw: async <R = unknown>(sql: string, params?: unknown[]) => {
                return this.queryRaw<R>(sql, params, collection);
            },
            cdc$,
        };
    }

    /**
     * Executes a raw commit event, mapping to typed engine mutations.
     */
    async commitRaw(event: unknown, defaultCollection?: string): Promise<void> {
        this.assertNotClosed();
        if (!event || typeof event !== 'object') {
            throw new Error('Raw commit event must be a non-null object.');
        }

        const raw = event as RawCommitEvent<any>;
        const type = raw.type;
        const collection = raw.collection || defaultCollection;
        const id = raw.id;

        if (!collection || !id) {
            throw new Error('Raw commit event must provide both collection and id.');
        }

        if (type === 'insert') {
            await this.insertDoc(collection, id, raw.data || {}, raw.blobs, raw.mutationId);
        } else if (type === 'update') {
            await this.updateDoc(collection, id, raw.data || {}, raw.blobs, raw.mutationId);
        } else if (type === 'patch') {
            await this.patchDoc(collection, id, raw.data || {}, raw.blobs, raw.mutationId);
        } else if (type === 'delete') {
            await this.deleteDoc(collection, id, raw.mutationId);
        } else {
            throw new Error(`Unsupported raw commit event type: '${type}'.`);
        }
    }

    /**
     * Executes a raw SQL SELECT query against SQLite. Rejects non-SELECT mutations.
     */
    async queryRaw<R = unknown>(sql: string, params?: unknown[], defaultCollection?: string): Promise<R[]> {
        this.assertNotClosed();
        const trimmed = sql.trim();

        // Enforce REQ-7: read-only, non-SELECT rejected
        if (!/^\s*(select|pragma)\b/i.test(trimmed)) {
            throw new Error(`Unsupported raw SQL query (only SELECT allowed): ${sql}`);
        }

        // Check if query targets a specific collection name instead of universal 'docs'
        const fromMatch = trimmed.match(/from\s+([`"'\w-]+)/i);
        let rewrittenSql = trimmed;

        if (fromMatch) {
            const rawTable = fromMatch[1].replace(/[`"']/g, '');
            if (rawTable !== 'docs' && rawTable !== '_livestruct_docs') {
                const targetCollection = defaultCollection || rawTable;
                // Rewrite query to run against subquery of the docs table
                const subquery = `(SELECT id, collection, rev, body AS data, body AS doc_data, blobs, updatedAt AS updated_at FROM docs WHERE collection = '${targetCollection}') AS ${rawTable}`;
                rewrittenSql = trimmed.replace(new RegExp(`\\bfrom\\s+${fromMatch[1]}\\b`, 'i'), `FROM ${subquery}`);
            }
        }

        const rows = this.store.query({
            query: rewrittenSql,
            bindValues: params || [],
        });

        if (!Array.isArray(rows)) {
            return [];
        }

        // Map column aliases for compatibility
        const mapped = rows.map((row: any) => {
            const result: Record<string, any> = { ...row };
            if (result.body !== undefined && result.data === undefined) {
                result.data = result.body;
            }
            if (result.data !== undefined && result.doc_data === undefined) {
                try {
                    result.doc_data = JSON.parse(result.data);
                } catch {
                    // Ignore parse error
                }
            }
            if (result.updatedAt !== undefined && result.updated_at === undefined) {
                result.updated_at = result.updatedAt;
            }

            // Case-insensitive count mapping
            const countKey = Object.keys(result).find((k) => k.toLowerCase() === 'count(*)');
            if (countKey && result.count === undefined) {
                result.count = result[countKey];
                result['count(*)'] = result[countKey];
            }

            return result;
        });

        return mapped as R[];
    }

    /**
     * Closes the engine, completes CDC streams, and shuts down LiveStore session.
     */
    async close(): Promise<void> {
        if (this._isClosed) {
            return;
        }
        this._isClosed = true;

        if (this.unsubscribeTable) {
            this.unsubscribeTable();
            this.unsubscribeTable = undefined;
        }

        this.cdcSubject.complete();
        this.localMutationIds.clear();
        this.localKnownDocs.clear();

        // Export state snapshot to legacy storage if provided
        if (this.storage && typeof this.storage.write === 'function' && this.store) {
            try {
                const rows = this.store.query(tables.docs);
                if (Array.isArray(rows)) {
                    const dumpDocs: Record<string, any> = {};
                    for (const r of rows) {
                        dumpDocs[`${r.collection}:${r.id}`] = {
                            collection: r.collection,
                            id: r.id,
                            rev: r.rev,
                            data: JSON.parse(r.body),
                            updatedAt: r.updatedAt,
                        };
                    }
                    const payload = JSON.stringify({
                        version: 1,
                        timestamp: Date.now(),
                        documents: dumpDocs,
                    });
                    const dbPath = this.config.storagePath || `${this.config.name || 'default'}.db`;
                    await this.storage.write(dbPath, new TextEncoder().encode(payload));
                }
            } catch {
                // Ignore backup write errors
            }
        }

        if (this.blobStore.close) {
            await this.blobStore.close();
        }

        if (this.store?.shutdownPromise) {
            try {
                await this.store.shutdownPromise();
            } catch {
                // Ignore if store is already shut down
            }
        }
    }

    private assertNotClosed(): void {
        if (this._isClosed) {
            throw new Error('LiveDocEngine is closed and cannot perform operations.');
        }
    }
}

// Deprecated backward-compatible alias
export { LiveDocEngine as LiveSqliteEngine };

/**
 * Factory function to create and initialize a LiveDocEngine backed by LiveStore.
 */
export async function createLiveEngine(config: EngineConfig): Promise<LiveDocEngine> {
    const resolved = resolveLiveStoreAdapter(config);
    const blobStore = resolveBlobStore(config.forceMemory || resolved.storageMode === 'in-memory');

    const store = await createStorePromise({
        schema,
        storeId: config.name || 'default',
        adapter: resolved.adapter,
        confirmUnsavedChanges: config.confirmUnsavedChanges ?? false,
        disableDevtools: config.disableDevtools ?? true,
    });

    const engine = new LiveDocEngine(config, store, blobStore);
    await engine.init();

    return engine;
}
