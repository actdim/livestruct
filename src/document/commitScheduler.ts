/**
 * @actdim/livestruct - CommitScheduler Implementation
 * Handles trailing debounce, maximum wait commit windows, batch SQLite commits,
 * and deferred Promise lifecycle with error rollback.
 */

import { Subject, Observable } from 'rxjs';
import type { LiveDocEngine } from '../engine/liveStoreEngine';
import type { BlobMap } from '../engine/types';
import { mergePatches } from '../engine/patch';
import { makeDocKey } from '../engine/schema';
import type { CommitPolicy, LiveDocumentOptions } from './types';

export interface CommitSchedulerDocumentTarget {
    onCommitSuccess(
        newRev: number,
        committedData: any,
        overlayId: string,
        committedPatch: Record<string, unknown>
    ): void;
    onCommitError(failedPatch: Record<string, unknown>, err: unknown): void;
}

interface DeferredItem {
    resolve: () => void;
    reject: (err: unknown) => void;
    patch: Record<string, unknown>;
}

interface PendingPatchEntry {
    readonly collection: string;
    readonly id: string;
    readonly docKey: string;
    mergedPatch: Record<string, unknown>;
    overlayId: string;
    firstQueuedAt: number;
    blobs?: BlobMap;
    debounceTimer: ReturnType<typeof setTimeout> | null;
    maxWaitTimer: ReturnType<typeof setTimeout> | null;
    readonly deferredList: DeferredItem[];
}

export interface CommitSchedulerConfig {
    commitPolicy?: CommitPolicy;
    commitDelayMs?: number; // default: 150
    maxCommitWaitMs?: number; // default: 1000
}

export class CommitScheduler {
    readonly defaultPolicy: CommitPolicy;
    readonly defaultDelayMs: number;
    readonly defaultMaxWaitMs: number;

    private readonly engine: LiveDocEngine;
    private readonly pendingMap = new Map<string, PendingPatchEntry>();
    private readonly registeredDocs = new Map<string, CommitSchedulerDocumentTarget>();
    private readonly errorSubject = new Subject<Error>();
    private readonly inFlightCommits = new Set<Promise<void>>();
    private isDisposed = false;

    constructor(engine: LiveDocEngine, config?: CommitSchedulerConfig) {
        this.engine = engine;
        this.defaultPolicy = config?.commitPolicy ?? 'lazy';
        this.defaultDelayMs = config?.commitDelayMs ?? 150;
        this.defaultMaxWaitMs = config?.maxCommitWaitMs ?? 1000;
    }

    get errors$(): Observable<Error> {
        return this.errorSubject.asObservable();
    }

    registerDocument(collection: string, id: string, doc: CommitSchedulerDocumentTarget): void {
        const key = makeDocKey(collection, id);
        this.registeredDocs.set(key, doc);
    }

    unregisterDocument(collection: string, id: string): void {
        const key = makeDocKey(collection, id);
        this.registeredDocs.delete(key);
    }

    hasPending(collection: string, id: string): boolean {
        return this.pendingMap.has(makeDocKey(collection, id));
    }

    getPendingPatch(collection: string, id: string): Record<string, unknown> | null {
        const entry = this.pendingMap.get(makeDocKey(collection, id));
        return entry ? entry.mergedPatch : null;
    }

    getPendingOverlayId(collection: string, id: string): string | null {
        const entry = this.pendingMap.get(makeDocKey(collection, id));
        return entry ? entry.overlayId : null;
    }

    schedulePatch(
        collection: string,
        id: string,
        patch: Record<string, unknown>,
        blobs?: BlobMap,
        options?: LiveDocumentOptions
    ): { promise: Promise<void>; overlayId: string } {
        if (this.isDisposed) {
            throw new Error(`Cannot schedule patch on disposed CommitScheduler.`);
        }

        const policy = options?.commitPolicy ?? this.defaultPolicy;
        const delayMs = options?.commitDelayMs ?? this.defaultDelayMs;
        const maxWaitMs = options?.maxCommitWaitMs ?? this.defaultMaxWaitMs;
        const docKey = makeDocKey(collection, id);

        let entry = this.pendingMap.get(docKey);
        if (!entry) {
            const overlayId = `mut_ovl_${id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            entry = {
                collection,
                id,
                docKey,
                mergedPatch: mergePatches({}, patch),
                overlayId,
                firstQueuedAt: Date.now(),
                blobs: blobs ? { ...blobs } : undefined,
                debounceTimer: null,
                maxWaitTimer: null,
                deferredList: [],
            };
            this.pendingMap.set(docKey, entry);
        } else {
            entry.mergedPatch = mergePatches(entry.mergedPatch, patch);
            if (blobs) {
                entry.blobs = { ...entry.blobs, ...blobs };
            }
        }

        let resolveFn!: () => void;
        let rejectFn!: (err: unknown) => void;
        const promise = new Promise<void>((resolve, reject) => {
            resolveFn = resolve;
            rejectFn = reject;
        });

        entry.deferredList.push({
            resolve: resolveFn,
            reject: rejectFn,
            patch,
        });

        if (policy === 'immediate') {
            void this.commitBatch([docKey]);
        } else {
            // Trailing debounce timer
            if (entry.debounceTimer !== null) {
                clearTimeout(entry.debounceTimer);
            }
            entry.debounceTimer = setTimeout(() => {
                void this.commitBatch([docKey]);
            }, delayMs);

            // Bounded maximum wait timer
            if (entry.maxWaitTimer === null) {
                const elapsed = Date.now() - entry.firstQueuedAt;
                const remaining = Math.max(0, maxWaitMs - elapsed);
                entry.maxWaitTimer = setTimeout(() => {
                    void this.commitBatch([docKey]);
                }, remaining);
            }
        }

        return {
            promise,
            overlayId: entry.overlayId,
        };
    }

    private clearEntryTimers(entry: PendingPatchEntry): void {
        if (entry.debounceTimer !== null) {
            clearTimeout(entry.debounceTimer);
            entry.debounceTimer = null;
        }
        if (entry.maxWaitTimer !== null) {
            clearTimeout(entry.maxWaitTimer);
            entry.maxWaitTimer = null;
        }
    }

    async commitBatch(docKeys: string[]): Promise<void> {
        if (this.isDisposed || docKeys.length === 0) {
            return;
        }

        const entriesToCommit: PendingPatchEntry[] = [];
        for (const key of docKeys) {
            const entry = this.pendingMap.get(key);
            if (entry) {
                this.clearEntryTimers(entry);
                this.pendingMap.delete(key);
                entriesToCommit.push(entry);
            }
        }

        if (entriesToCommit.length === 0) {
            return;
        }

        const task = (async () => {
            try {
                const records = await this.engine.commitBatchedPatches(
                    entriesToCommit.map((e) => ({
                        collection: e.collection,
                        id: e.id,
                        patch: e.mergedPatch,
                        blobs: e.blobs,
                        overlayId: e.overlayId,
                        emitCDC: false, // Already emitted in doc.patch()
                    }))
                );

                for (let i = 0; i < entriesToCommit.length; i++) {
                    const entry = entriesToCommit[i];
                    const rec = records[i];
                    const target = this.registeredDocs.get(entry.docKey);
                    if (target && rec) {
                        target.onCommitSuccess(rec.rev, rec.data, entry.overlayId, entry.mergedPatch);
                    }
                    for (const def of entry.deferredList) {
                        def.resolve();
                    }
                }
            } catch (err) {
                for (const entry of entriesToCommit) {
                    const target = this.registeredDocs.get(entry.docKey);
                    if (target) {
                        target.onCommitError(entry.mergedPatch, err);
                    }
                    for (const def of entry.deferredList) {
                        def.reject(err);
                    }
                }
                const errorObj = err instanceof Error ? err : new Error(String(err));
                this.errorSubject.next(errorObj);
                throw errorObj;
            }
        })();

        this.inFlightCommits.add(task);
        try {
            await task;
        } catch {
            // Error already dispatched to deferred promises and errorSubject
        } finally {
            this.inFlightCommits.delete(task);
        }
    }

    async flushDoc(collection: string, id: string): Promise<void> {
        const docKey = makeDocKey(collection, id);
        await this.commitBatch([docKey]);
        if (this.inFlightCommits.size > 0) {
            await Promise.all(Array.from(this.inFlightCommits));
        }
    }

    async flushCollection(collection: string): Promise<void> {
        const matchingKeys: string[] = [];
        for (const [key, entry] of this.pendingMap.entries()) {
            if (entry.collection === collection) {
                matchingKeys.push(key);
            }
        }
        await this.commitBatch(matchingKeys);
        if (this.inFlightCommits.size > 0) {
            await Promise.all(Array.from(this.inFlightCommits));
        }
    }

    async flushAll(): Promise<void> {
        const allKeys = Array.from(this.pendingMap.keys());
        await this.commitBatch(allKeys);
        if (this.inFlightCommits.size > 0) {
            await Promise.all(Array.from(this.inFlightCommits));
        }
    }

    dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.isDisposed = true;

        for (const entry of this.pendingMap.values()) {
            this.clearEntryTimers(entry);
            for (const def of entry.deferredList) {
                def.reject(new Error('CommitScheduler was disposed before commit finished.'));
            }
        }
        this.pendingMap.clear();
        this.registeredDocs.clear();
        this.errorSubject.complete();
    }
}
