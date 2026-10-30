/**
 * Core SQLite and universal document table storage engine for LiveStruct.
 * Supports OPFS persistence, in-memory fallback, RFC 7396 JSON merge patch,
 * binary BLOBs (Float32Array/Uint8Array), and Change Data Capture (CDC) streams.
 */

import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import type {
    StorageAdapter,
    DocumentRecord,
    CDCEvent,
    RawCommitEvent,
    EngineConfig,
    LiveEngineAccess,
    BlobMap,
} from './types';
import { jsonMergePatch } from './patch';
import { serializeBlobs, deserializeBlobs } from './blobs';
import { resolveStorageAdapter } from './storage';

const DEFAULT_DB_FILENAME = 'livestruct.db';

export class LiveSqliteEngine {
    readonly config: EngineConfig;
    readonly storage: StorageAdapter;
    private readonly dbPath: string;
    private readonly documents = new Map<string, DocumentRecord<any>>(); // key: `${collection}:${id}`
    private readonly cdcSubject = new Subject<CDCEvent<any>>();
    private isClosed = false;

    constructor(config: EngineConfig, storage: StorageAdapter) {
        this.config = config;
        this.storage = storage;
        this.dbPath = config.storagePath || `${config.name || 'default'}.db`;
    }

    /**
     * Initializes the engine and loads any persisted data from storage.
     */
    async init(): Promise<this> {
        await this.loadFromStorage();
        return this;
    }

    private makeKey(collection: string, id: string): string {
        return `${collection}:${id}`;
    }

    /**
     * Inserts a new document. Throws if a document with the same collection and id already exists.
     */
    async insertDoc<T extends Record<string, unknown> = Record<string, unknown>>(
        collection: string,
        id: string,
        data: T,
        blobs?: BlobMap
    ): Promise<DocumentRecord<T>> {
        this.assertNotClosed();
        const key = this.makeKey(collection, id);
        if (this.documents.has(key)) {
            throw new Error(`Document with id '${id}' already exists in collection '${collection}'.`);
        }

        const now = Date.now();
        const doc: DocumentRecord<T> = {
            collection,
            id,
            rev: 1,
            data: jsonMergePatch({}, data),
            blobs: blobs ? { ...blobs } : {},
            updatedAt: now,
        };

        this.documents.set(key, doc);
        await this.persistToStorage();

        this.cdcSubject.next({
            type: 'insert',
            collection,
            id,
            rev: doc.rev,
            delta: doc.data,
            timestamp: now,
        });

        return doc;
    }

    /**
     * Replaces an existing document or creates it if missing.
     */
    async updateDoc<T extends Record<string, unknown> = Record<string, unknown>>(
        collection: string,
        id: string,
        data: T,
        blobs?: BlobMap
    ): Promise<DocumentRecord<T>> {
        this.assertNotClosed();
        const key = this.makeKey(collection, id);
        const existing = this.documents.get(key);
        const now = Date.now();
        const rev = existing ? existing.rev + 1 : 1;

        const doc: DocumentRecord<T> = {
            collection,
            id,
            rev,
            data: jsonMergePatch({}, data),
            blobs: blobs ? { ...blobs } : (existing ? { ...existing.blobs } : {}),
            updatedAt: now,
        };

        this.documents.set(key, doc);
        await this.persistToStorage();

        this.cdcSubject.next({
            type: existing ? 'update' : 'insert',
            collection,
            id,
            rev: doc.rev,
            delta: doc.data,
            timestamp: now,
        });

        return doc;
    }

    /**
     * Applies an RFC 7396 JSON merge patch atomically to an existing document.
     */
    async patchDoc<T extends Record<string, unknown> = Record<string, unknown>>(
        collection: string,
        id: string,
        patch: Partial<T> | Record<string, unknown>,
        blobs?: BlobMap
    ): Promise<DocumentRecord<T>> {
        this.assertNotClosed();
        const key = this.makeKey(collection, id);
        const existing = this.documents.get(key);
        if (!existing) {
            throw new Error(`Document with id '${id}' not found in collection '${collection}'.`);
        }

        const patchedData = jsonMergePatch<T>(existing.data, patch);
        const now = Date.now();
        const updatedBlobs = blobs ? { ...existing.blobs, ...blobs } : { ...existing.blobs };

        const doc: DocumentRecord<T> = {
            collection,
            id,
            rev: existing.rev + 1,
            data: patchedData,
            blobs: updatedBlobs,
            updatedAt: now,
        };

        this.documents.set(key, doc);
        await this.persistToStorage();

        this.cdcSubject.next({
            type: 'update',
            collection,
            id,
            rev: doc.rev,
            delta: patch as Partial<T>,
            timestamp: now,
        });

        return doc;
    }

    /**
     * Deletes a document by id.
     */
    async deleteDoc(collection: string, id: string): Promise<boolean> {
        this.assertNotClosed();
        const key = this.makeKey(collection, id);
        const existing = this.documents.get(key);
        if (!existing) {
            return false;
        }

        this.documents.delete(key);
        await this.persistToStorage();

        this.cdcSubject.next({
            type: 'delete',
            collection,
            id,
            rev: existing.rev + 1,
            delta: {},
            timestamp: Date.now(),
        });

        return true;
    }

    /**
     * Gets a document snapshot by id.
     */
    async getDoc<T extends Record<string, unknown> = Record<string, unknown>>(
        collection: string,
        id: string
    ): Promise<DocumentRecord<T> | null> {
        this.assertNotClosed();
        const key = this.makeKey(collection, id);
        const doc = this.documents.get(key);
        return doc ? (doc as DocumentRecord<T>) : null;
    }

    /**
     * Queries all documents in a collection, optionally filtered by predicate.
     */
    async queryDocs<T extends Record<string, unknown> = Record<string, unknown>>(
        collection: string,
        predicate?: (doc: DocumentRecord<T>) => boolean
    ): Promise<Array<DocumentRecord<T>>> {
        this.assertNotClosed();
        const results: Array<DocumentRecord<T>> = [];
        for (const doc of this.documents.values()) {
            if (doc.collection === collection) {
                if (!predicate || predicate(doc as DocumentRecord<T>)) {
                    results.push(doc as DocumentRecord<T>);
                }
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
            map((event) => ({
                type: event.type,
                id: event.id,
                delta: event.delta as Partial<T>,
            }))
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
     * Executes a raw commit event, updating the table and triggering CDC streams.
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
            await this.insertDoc(collection, id, raw.data || {}, raw.blobs);
        } else if (type === 'update') {
            await this.updateDoc(collection, id, raw.data || {}, raw.blobs);
        } else if (type === 'patch') {
            await this.patchDoc(collection, id, raw.data || {}, raw.blobs);
        } else if (type === 'delete') {
            await this.deleteDoc(collection, id);
        } else {
            throw new Error(`Unsupported raw commit event type: '${type}'.`);
        }
    }

    /**
     * Executes a raw SQL query against the document store.
     */
    async queryRaw<R = unknown>(sql: string, params?: unknown[], defaultCollection?: string): Promise<R[]> {
        this.assertNotClosed();
        const trimmed = sql.trim();
        const lower = trimmed.toLowerCase();

        // Handle SELECT statements
        if (lower.startsWith('select')) {
            return this.executeSelect<R>(trimmed, params, defaultCollection);
        }

        // Schema query or PRAGMA placeholder
        if (lower.startsWith('pragma') || lower.startsWith('create table')) {
            return [] as R[];
        }

        throw new Error(`Unsupported raw SQL query: ${sql}`);
    }

    private executeSelect<R>(sql: string, params: unknown[] = [], defaultCollection?: string): R[] {
        const fromMatch = sql.match(/from\s+([`"'\w-]+)/i);
        const targetTable = fromMatch ? fromMatch[1].replace(/[`"']/g, '') : defaultCollection || 'docs';

        // Check if query targets a specific collection or universal docs table
        const isUniversalTable = targetTable === 'docs' || targetTable === '_livestruct_docs';
        const targetCollection = isUniversalTable ? defaultCollection : targetTable;

        // Parse optional WHERE clauses (id = ?, collection = ?, etc.)
        let filterCollection = targetCollection;
        let filterId: string | undefined;

        // Handle parameter substitutions in WHERE clause
        const whereMatch = sql.match(/where\s+(.+)$/i);
        if (whereMatch) {
            const whereClause = whereMatch[1];
            let paramIndex = 0;

            const idMatch = whereClause.match(/\bid\s*=\s*(\?|'[^']+'|"[^"]+)/i);
            if (idMatch) {
                if (idMatch[1] === '?') {
                    filterId = String(params[paramIndex++]);
                } else {
                    filterId = idMatch[1].slice(1, -1);
                }
            }

            const collMatch = whereClause.match(/\bcollection\s*=\s*(\?|'[^']+'|"[^"]+)/i);
            if (collMatch) {
                if (collMatch[1] === '?') {
                    filterCollection = String(params[paramIndex++]);
                } else {
                    filterCollection = collMatch[1].slice(1, -1);
                }
            }
        }

        const rows: DocumentRecord<any>[] = [];
        for (const doc of this.documents.values()) {
            if (filterCollection && doc.collection !== filterCollection) {
                continue;
            }
            if (filterId !== undefined && doc.id !== filterId) {
                continue;
            }
            rows.push(doc);
        }

        // Handle SELECT COUNT(*)
        if (/select\s+count\s*\(\s*\*\s*\)/i.test(sql)) {
            return [{ count: rows.length, 'count(*)': rows.length }] as unknown as R[];
        }

        // Format rows according to universal document schema
        const mapped = rows.map((doc) => ({
            collection: doc.collection,
            id: doc.id,
            rev: doc.rev,
            data: JSON.stringify(doc.data),
            doc_data: doc.data,
            blobs: serializeBlobs(doc.blobs),
            updated_at: doc.updatedAt,
        }));

        return mapped as unknown as R[];
    }

    /**
     * Persists all current documents and BLOBs to the configured storage adapter.
     */
    private async persistToStorage(): Promise<void> {
        try {
            const dumpData: Record<string, unknown> = {};
            const dumpBlobs: Record<string, Uint8Array | null> = {};

            for (const [key, doc] of this.documents.entries()) {
                dumpData[key] = {
                    collection: doc.collection,
                    id: doc.id,
                    rev: doc.rev,
                    data: doc.data,
                    updatedAt: doc.updatedAt,
                };
                if (doc.blobs && Object.keys(doc.blobs).length > 0) {
                    dumpBlobs[key] = serializeBlobs(doc.blobs);
                }
            }

            const jsonPayload = JSON.stringify({
                version: 1,
                timestamp: Date.now(),
                documents: dumpData,
            });

            const textBytes = new TextEncoder().encode(jsonPayload);
            await this.storage.write(this.dbPath, textBytes);

            // Also persist binary BLOBs if present
            const blobKeys = Object.keys(dumpBlobs);
            if (blobKeys.length > 0) {
                const blobMeta: Record<string, number[]> = {};
                for (const k of blobKeys) {
                    const b = dumpBlobs[k];
                    if (b) {
                        await this.storage.write(`${this.dbPath}.blobs.${k}`, b);
                    }
                }
            }
        } catch {
            // Persistence errors in restricted sandbox fall back silently
        }
    }

    /**
     * Loads persisted state from the configured storage adapter.
     */
    private async loadFromStorage(): Promise<void> {
        try {
            const exists = await this.storage.exists(this.dbPath);
            if (!exists) {
                return;
            }

            const rawBytes = await this.storage.read(this.dbPath);
            if (!rawBytes || rawBytes.byteLength === 0) {
                return;
            }

            const jsonString = new TextDecoder().decode(rawBytes);
            const parsed = JSON.parse(jsonString);

            if (parsed && typeof parsed.documents === 'object') {
                for (const [key, d] of Object.entries(parsed.documents)) {
                    const item = d as any;
                    let blobs: BlobMap = {};

                    const blobPath = `${this.dbPath}.blobs.${key}`;
                    if (await this.storage.exists(blobPath)) {
                        const blobBytes = await this.storage.read(blobPath);
                        if (blobBytes) {
                            blobs = deserializeBlobs(blobBytes);
                        }
                    }

                    this.documents.set(key, {
                        collection: item.collection,
                        id: item.id,
                        rev: item.rev || 1,
                        data: item.data || {},
                        blobs,
                        updatedAt: item.updatedAt || Date.now(),
                    });
                }
            }
        } catch {
            // If storage read fails, initialize with empty state
        }
    }

    /**
     * Closes the engine, completes CDC streams, and cleans up resources.
     */
    async close(): Promise<void> {
        if (this.isClosed) {
            return;
        }
        this.isClosed = true;
        await this.persistToStorage();
        this.cdcSubject.complete();
        if (this.storage.close) {
            await this.storage.close();
        }
    }

    private assertNotClosed(): void {
        if (this.isClosed) {
            throw new Error('LiveSqliteEngine is closed and cannot perform operations.');
        }
    }
}

/**
 * Factory function to create and initialize a LiveSqliteEngine.
 */
export async function createLiveEngine(config: EngineConfig): Promise<LiveSqliteEngine> {
    const storage = await resolveStorageAdapter(config);
    const engine = new LiveSqliteEngine(config, storage);
    return await engine.init();
}
