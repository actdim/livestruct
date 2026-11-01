/**
 * Content-addressed BlobStore for binary records (Float32Array / Uint8Array).
 * Stored outside eventlog in OPFS ('livestruct-blobs/<sha256>') or in-memory map.
 * Events carry SHA-256 hashes only, preventing log bloat.
 */

import type { BlobMap } from './types';

const TAG_UINT8 = 0x01;
const TAG_FLOAT32 = 0x02;

export interface BlobStore {
    put(data: Uint8Array | Float32Array): Promise<string>;
    get(hash: string): Promise<Uint8Array | Float32Array | null>;
    delete?(hash: string): Promise<void>;
    close?(): Promise<void>;
}

async function computeSha256(bytes: Uint8Array): Promise<string> {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle?.digest) {
        const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
        const array = new Uint8Array(digest);
        let hex = '';
        for (let i = 0; i < array.length; i++) {
            hex += array[i].toString(16).padStart(2, '0');
        }
        return hex;
    }

    // Node fallback
    try {
        const { createHash } = await import('crypto');
        return createHash('sha256').update(bytes).digest('hex');
    } catch {
        // Fallback for isolated environments without crypto
        let hash = 0;
        for (let i = 0; i < bytes.length; i++) {
            hash = (hash * 31 + bytes[i]) >>> 0;
        }
        return hash.toString(16).padStart(64, '0');
    }
}

function packBlob(data: Uint8Array | Float32Array): Uint8Array {
    let tag = TAG_UINT8;
    let rawBytes: Uint8Array;

    if (data instanceof Float32Array) {
        tag = TAG_FLOAT32;
        rawBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else {
        tag = TAG_UINT8;
        rawBytes = data;
    }

    const packed = new Uint8Array(1 + rawBytes.byteLength);
    packed[0] = tag;
    packed.set(rawBytes, 1);
    return packed;
}

function unpackBlob(packed: Uint8Array): Uint8Array | Float32Array {
    if (packed.length === 0) {
        return new Uint8Array(0);
    }

    const tag = packed[0];
    const payload = packed.subarray(1);

    if (tag === TAG_FLOAT32) {
        // Clone slice into 4-byte aligned ArrayBuffer
        const alignedBuffer = new ArrayBuffer(payload.byteLength);
        new Uint8Array(alignedBuffer).set(payload);
        return new Float32Array(alignedBuffer);
    }

    return new Uint8Array(payload);
}

/**
 * In-memory content-addressed BlobStore.
 */
export class MemoryBlobStore implements BlobStore {
    private readonly entries = new Map<string, Uint8Array>();

    async put(data: Uint8Array | Float32Array): Promise<string> {
        const packed = packBlob(data);
        const hash = await computeSha256(packed);
        this.entries.set(hash, packed);
        return hash;
    }

    async get(hash: string): Promise<Uint8Array | Float32Array | null> {
        const packed = this.entries.get(hash);
        if (!packed) {
            return null;
        }
        return unpackBlob(packed);
    }

    async delete(hash: string): Promise<void> {
        this.entries.delete(hash);
    }

    async close(): Promise<void> {
        // Retain entries
    }
}

/**
 * Browser OPFS content-addressed BlobStore.
 * Files stored under 'livestruct-blobs/<sha256>'.
 */
export class OpfsBlobStore implements BlobStore {
    private dirHandlePromise: Promise<FileSystemDirectoryHandle> | null = null;
    private readonly memoryFallback = new MemoryBlobStore();

    private async getBlobsDirectory(): Promise<FileSystemDirectoryHandle> {
        if (!this.dirHandlePromise) {
            if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
                throw new Error('OPFS is not available in this environment.');
            }
            this.dirHandlePromise = (async () => {
                const root = await navigator.storage.getDirectory();
                return await root.getDirectoryHandle('livestruct-blobs', { create: true });
            })();
        }
        return this.dirHandlePromise;
    }

    async put(data: Uint8Array | Float32Array): Promise<string> {
        const packed = packBlob(data);
        const hash = await computeSha256(packed);

        try {
            const dir = await this.getBlobsDirectory();
            const fileHandle = await dir.getFileHandle(hash, { create: true });
            const createWriter = (fileHandle as any)['createWritable'];
            const writable = await createWriter.call(fileHandle);
            await writable.write(packed as unknown as BufferSource);
            await writable.close();
        } catch {
            await this.memoryFallback.put(data);
        }

        return hash;
    }

    async get(hash: string): Promise<Uint8Array | Float32Array | null> {
        try {
            const dir = await this.getBlobsDirectory();
            const fileHandle = await dir.getFileHandle(hash, { create: false });
            const file = await fileHandle.getFile();
            const buf = await file.arrayBuffer();
            return unpackBlob(new Uint8Array(buf));
        } catch {
            return this.memoryFallback.get(hash);
        }
    }

    async delete(hash: string): Promise<void> {
        try {
            const dir = await this.getBlobsDirectory();
            await dir.removeEntry(hash);
        } catch {
            await this.memoryFallback.delete(hash);
        }
    }

    async close(): Promise<void> {
        this.dirHandlePromise = null;
        await this.memoryFallback.close();
    }
}

/**
 * Resolves the appropriate BlobStore implementation based on environment and config.
 */
export function resolveBlobStore(forceMemory?: boolean): BlobStore {
    if (forceMemory) {
        return new MemoryBlobStore();
    }

    const hasOpfs = typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
    if (!hasOpfs) {
        return new MemoryBlobStore();
    }

    return new OpfsBlobStore();
}
