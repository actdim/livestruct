/**
 * Migration helper for legacy v1 JSON-file databases (<name>.db).
 * Imports existing JSON records into LiveStore built-in SQLite schema once
 * and renames the file to <name>.db.migrated.
 */

import type { StorageAdapter, EngineConfig } from './types';
import { resolveStorageAdapter } from './storage';
import { deserializeBlobs } from './blobs';
import type { BlobStore } from './blobStore';
import { events } from './schema';

export async function migrateLegacyV1(
    config: EngineConfig,
    store: any,
    blobStore: BlobStore,
    storageOverride?: StorageAdapter
): Promise<boolean> {
    const dbPath = config.storagePath || `${config.name || 'default'}.db`;
    const storage = storageOverride || (await resolveStorageAdapter(config));

    try {
        const exists = await storage.exists(dbPath);
        if (!exists) {
            return false;
        }

        const rawBytes = await storage.read(dbPath);
        if (!rawBytes || rawBytes.byteLength === 0) {
            return false;
        }

        const jsonString = new TextDecoder().decode(rawBytes);
        const parsed = JSON.parse(jsonString);

        if (!parsed || typeof parsed.documents !== 'object') {
            return false;
        }

        const commitEvents: any[] = [];
        const blobPathsToDelete: string[] = [];

        for (const [key, item] of Object.entries(parsed.documents)) {
            const doc = item as any;
            const collection = doc.collection;
            const id = doc.id;
            const data = doc.data || {};
            const updatedAt = doc.updatedAt || Date.now();

            let blobHashes: Record<string, string> = {};
            const blobPath = `${dbPath}.blobs.${key}`;

            if (await storage.exists(blobPath)) {
                blobPathsToDelete.push(blobPath);
                const blobBytes = await storage.read(blobPath);
                if (blobBytes) {
                    const deserialized = deserializeBlobs(blobBytes);
                    for (const [bName, bData] of Object.entries(deserialized)) {
                        const hash = await blobStore.put(bData);
                        blobHashes[bName] = hash;
                    }
                }
            }

            commitEvents.push(
                events.DocInserted({
                    collection,
                    id,
                    data: JSON.stringify(data),
                    blobs: Object.keys(blobHashes).length > 0 ? JSON.stringify(blobHashes) : '{}',
                    mutationId: `mig_${id}_${updatedAt}`,
                    origin: 'migration',
                    updatedAt,
                })
            );
        }

        if (commitEvents.length > 0) {
            store.commit(...commitEvents);
        }

        // Rename legacy database file to .migrated
        const migratedPath = `${dbPath}.migrated`;
        await storage.write(migratedPath, rawBytes);
        await storage.delete(dbPath);

        // Clean up legacy blob files
        for (const bPath of blobPathsToDelete) {
            try {
                await storage.delete(bPath);
            } catch {
                // Ignore cleanup errors
            }
        }

        return true;
    } catch {
        return false;
    }
}
