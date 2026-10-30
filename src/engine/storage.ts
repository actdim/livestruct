/**
 * Storage adapters for browser OPFS and universal memory fallback.
 */

import type { StorageAdapter, StorageMode, EngineConfig } from './types';

/**
 * In-memory storage adapter for testing, SSR, Node environments, and fallback.
 */
export class MemoryStorageAdapter implements StorageAdapter {
    readonly mode: StorageMode = 'memory';
    private readonly storage = new Map<string, Uint8Array>();

    async read(path: string): Promise<Uint8Array | null> {
        const item = this.storage.get(path);
        if (!item) {
            return null;
        }
        return new Uint8Array(item);
    }

    async write(path: string, data: Uint8Array): Promise<void> {
        this.storage.set(path, new Uint8Array(data));
    }

    async delete(path: string): Promise<void> {
        this.storage.delete(path);
    }

    async exists(path: string): Promise<boolean> {
        return this.storage.has(path);
    }

    async close(): Promise<void> {
        // No-op for in-memory storage to preserve persisted data across reconnects
    }
}

/**
 * Browser OPFS (Origin Private File System) storage adapter.
 */
export class OpfsStorageAdapter implements StorageAdapter {
    readonly mode: StorageMode = 'opfs';
    private rootDirPromise: Promise<FileSystemDirectoryHandle> | null = null;

    private getRootDirectory(): Promise<FileSystemDirectoryHandle> {
        if (!this.rootDirPromise) {
            if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
                return Promise.reject(new Error('OPFS is not supported in this runtime environment.'));
            }
            this.rootDirPromise = navigator.storage.getDirectory();
        }
        return this.rootDirPromise;
    }

    private async resolveFileHandle(path: string, create: boolean): Promise<FileSystemFileHandle | null> {
        try {
            const root = await this.getRootDirectory();
            const segments = path.split('/').filter(Boolean);
            let currentDir = root;

            for (let i = 0; i < segments.length - 1; i++) {
                currentDir = await currentDir.getDirectoryHandle(segments[i], { create });
            }

            const fileName = segments[segments.length - 1];
            return await currentDir.getFileHandle(fileName, { create });
        } catch {
            return null;
        }
    }

    async read(path: string): Promise<Uint8Array | null> {
        try {
            const handle = await this.resolveFileHandle(path, false);
            if (!handle) {
                return null;
            }
            const file = await handle.getFile();
            const arrayBuffer = await file.arrayBuffer();
            return new Uint8Array(arrayBuffer);
        } catch {
            return null;
        }
    }

    async write(path: string, data: Uint8Array): Promise<void> {
        const handle = await this.resolveFileHandle(path, true);
        if (!handle) {
            throw new Error(`Failed to resolve file handle for write: ${path}`);
        }
        const writable = await handle.createWritable();
        await writable.write(data as unknown as BufferSource);
        await writable.close();
    }

    async delete(path: string): Promise<void> {
        try {
            const root = await this.getRootDirectory();
            const segments = path.split('/').filter(Boolean);
            let currentDir = root;

            for (let i = 0; i < segments.length - 1; i++) {
                currentDir = await currentDir.getDirectoryHandle(segments[i], { create: false });
            }

            const fileName = segments[segments.length - 1];
            await currentDir.removeEntry(fileName);
        } catch {
            // No-op if file does not exist
        }
    }

    async exists(path: string): Promise<boolean> {
        const handle = await this.resolveFileHandle(path, false);
        return handle !== null;
    }

    async close(): Promise<void> {
        this.rootDirPromise = null;
    }
}

/**
 * Resolves the appropriate storage adapter based on configuration and runtime capabilities.
 */
export async function resolveStorageAdapter(config: EngineConfig): Promise<StorageAdapter> {
    if (config.forceMemory || config.storagePath === ':memory:') {
        return new MemoryStorageAdapter();
    }

    const hasOpfs = typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
    if (!hasOpfs) {
        return new MemoryStorageAdapter();
    }

    try {
        const opfs = new OpfsStorageAdapter();
        // Probe OPFS availability
        await opfs.exists('__probe__');
        return opfs;
    } catch {
        return new MemoryStorageAdapter();
    }
}
