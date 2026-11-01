/**
 * @actdim/livestruct - LiveDocument Implementation
 * Reactive document with instant local mutation, RFC 7396 merge patch,
 * transparent lazy commits, live tentative overlays, MobX atom integration,
 * remote change rebasing, and low-level engine escape hatch.
 */

import { BehaviorSubject, Subject, Observable, Subscription, EMPTY } from 'rxjs';
import { filter } from 'rxjs/operators';
import { createAtom, type IAtom } from 'mobx';
import type { LiveEngineAccess, LiveSqliteEngine } from '../engine/index';
import type { CDCEvent } from '../engine/types';
import { jsonMergePatch, mergePatches } from '../engine/patch';
import type { NestedPath, PathValue } from '../lens/index';
import type { LiveDocument, LiveDocumentOptions, LiveStructEvent, PatchPayload } from './types';
import { assertJsonSafe, setAtPath, buildPathPatch } from './patchHelper';
import { deepFreeze } from './deepFreeze';
import { deepEquals } from './equal';
import { CommitScheduler, type CommitSchedulerDocumentTarget } from './commitScheduler';
import type { OverlayChannel, OverlayDocumentTarget } from './overlayChannel';

export class LiveDocumentImpl<T extends object = Record<string, any>>
    implements LiveDocument<T>, CommitSchedulerDocumentTarget, OverlayDocumentTarget
{
    readonly id: string;
    readonly collectionName: string;
    readonly engine: LiveEngineAccess<T>;

    private readonly rawEngine: LiveSqliteEngine;
    private readonly commitScheduler: CommitScheduler;
    private readonly overlayChannel?: OverlayChannel;
    private readonly options?: LiveDocumentOptions;
    private readonly onEvent?: (event: LiveStructEvent) => void;
    private readonly allEvents$?: Observable<LiveStructEvent>;

    private committedData: Readonly<T>;
    private committedRev: number;
    private localPendingPatch: Record<string, unknown> | null = null;
    private localPendingPathSets: Array<{ path: string; value: unknown }> = [];
    private remoteTentativePatch: Record<string, unknown> | null = null;
    private remoteOverlayId: string | null = null;
    private readonly pendingOverlayIds = new Set<string>();

    private currentData: Readonly<T>;
    private currentRev: number;
    private readonly stateSubject: BehaviorSubject<Readonly<T>>;
    private readonly errorSubject = new Subject<Error>();
    private readonly cdcSubscription: Subscription;
    private readonly atom: IAtom;
    private disposed = false;

    constructor(
        collectionName: string,
        id: string,
        initialData: T,
        initialRev: number,
        rawEngine: LiveSqliteEngine,
        engineAccess: LiveEngineAccess<T>,
        commitScheduler?: CommitScheduler,
        overlayChannel?: OverlayChannel,
        options?: LiveDocumentOptions,
        onEvent?: (event: LiveStructEvent) => void,
        allEvents$?: Observable<LiveStructEvent>
    ) {
        this.collectionName = collectionName;
        this.id = id;
        this.rawEngine = rawEngine;
        this.engine = engineAccess;
        this.committedRev = initialRev;
        this.currentRev = initialRev;
        this.options = options;
        this.onEvent = onEvent;
        this.allEvents$ = allEvents$;

        this.commitScheduler = commitScheduler ?? new CommitScheduler(rawEngine as any);
        this.overlayChannel = overlayChannel;

        this.committedData = deepFreeze(structuredClone(initialData)) as unknown as T;
        this.currentData = this.committedData;
        this.stateSubject = new BehaviorSubject<Readonly<T>>(this.currentData);

        this.atom = createAtom(
            `LiveDocument:${collectionName}:${id}`,
            () => {},
            () => {}
        );

        this.commitScheduler.registerDocument(this.collectionName, this.id, this);
        if (this.overlayChannel) {
            this.overlayChannel.registerDocument(this.collectionName, this.id, this);
        }

        // Subscribe to CDC stream with remote rebase and echo suppression
        this.cdcSubscription = this.engine.cdc$
            .pipe(filter((event) => event.id === this.id))
            .subscribe((event) => {
                this.handleCDCEvent(event as CDCEvent<T>);
            });
    }

    get subscriptionCount(): number {
        return this.disposed || this.cdcSubscription.closed ? 0 : 1;
    }

    private handleCDCEvent(event: CDCEvent<T>): void {
        if (this.disposed) {
            return;
        }

        // Suppress our own pending local mutations/echoes
        if (event.mutationId && this.pendingOverlayIds.has(event.mutationId)) {
            return;
        }

        if (event.type === 'delete') {
            this.dispose();
            return;
        }

        if (event.type === 'update' || event.type === 'insert') {
            // Drop matching tentative overlay if commit arrived
            this.overlayChannel?.dropOverlay(this.collectionName, this.id, event.overlayId);
            if (!event.overlayId || this.remoteOverlayId === event.overlayId) {
                this.remoteTentativePatch = null;
                this.remoteOverlayId = null;
            }

            const delta = (event.delta || event.data) as Partial<T>;
            if (event.kind === 'replace' || (event as any).type === 'replace') {
                const replacement = (event.data || delta) as T;
                this.committedData = deepFreeze(structuredClone(replacement)) as unknown as T;
            } else if (event.type === 'insert') {
                this.committedData = deepFreeze(
                    structuredClone(jsonMergePatch<T>({} as T, delta))
                ) as unknown as T;
            } else {
                this.committedData = deepFreeze(
                    structuredClone(jsonMergePatch<T>(this.committedData, delta))
                ) as unknown as T;
            }

            if (event.rev !== undefined && event.rev > this.committedRev) {
                this.committedRev = event.rev;
            } else {
                this.committedRev++;
            }

            // REBASE:
            // view = remoteCommitted with local pending patches re-applied on top.
            this.recomputeView(true);
        }
    }

    private recomputeView(notifyIfChanged: boolean): void {
        let nextData: T;
        if (this.localPendingPatch !== null || this.localPendingPathSets.length > 0) {
            nextData = this.committedData as unknown as T;
            if (this.localPendingPatch !== null) {
                nextData = jsonMergePatch<T>(nextData, this.localPendingPatch);
            }
            for (const ps of this.localPendingPathSets) {
                nextData = setAtPath(nextData as any, ps.path, ps.value);
            }
        } else if (this.remoteTentativePatch !== null) {
            nextData = jsonMergePatch<T>(this.committedData, this.remoteTentativePatch);
        } else {
            nextData = this.committedData as unknown as T;
        }

        if (!deepEquals(this.currentData, nextData)) {
            this.currentData = deepFreeze(nextData) as unknown as T;
            if (notifyIfChanged) {
                this.stateSubject.next(this.currentData);
                this.atom.reportChanged();
            }
        }
    }

    get data(): Readonly<T> {
        this.atom.reportObserved();
        return this.currentData;
    }

    get $(): Observable<Readonly<T>> {
        return this.stateSubject.asObservable();
    }

    get errors$(): Observable<Error> {
        return this.errorSubject.asObservable();
    }

    get events$(): Observable<LiveStructEvent> {
        if (!this.allEvents$) {
            return EMPTY;
        }
        return this.allEvents$.pipe(
            filter((e) => e.collection === this.collectionName && e.id === this.id)
        );
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    get isPending(): boolean {
        return this.localPendingPatch !== null || this.localPendingPathSets.length > 0;
    }

    get isTentative(): boolean {
        return this.remoteTentativePatch !== null && !this.isPending;
    }

    async patch(partial: PatchPayload<T>): Promise<void> {
        if (this.disposed) {
            throw new Error(`Cannot patch disposed LiveDocument '${this.id}'.`);
        }

        assertJsonSafe(partial);
        const patchRecord = partial as Record<string, unknown>;

        // 1. Update local pending patch
        if (this.localPendingPatch === null) {
            this.localPendingPatch = mergePatches({}, patchRecord);
        } else {
            this.localPendingPatch = mergePatches(this.localPendingPatch, patchRecord);
        }

        // Local edits supersede any remote tentative overlay
        this.remoteTentativePatch = null;
        this.remoteOverlayId = null;

        // 2. Optimistic local update: instant data update, emit on $ and MobX atom
        this.currentRev++;
        this.recomputeView(true);

        // 3. Queue deferred commit with CommitScheduler
        const { promise, overlayId } = this.commitScheduler.schedulePatch(
            this.collectionName,
            this.id,
            patchRecord,
            undefined,
            this.options
        );
        this.pendingOverlayIds.add(overlayId);

        // 4. Emit local CDC immediately without waiting for commit (isolated cloned delta)
        const isolatedDelta = deepFreeze(structuredClone(partial)) as Partial<T>;
        this.rawEngine.emitCDC({
            type: 'update',
            kind: 'update',
            collection: this.collectionName,
            id: this.id,
            rev: this.currentRev,
            delta: isolatedDelta,
            data: this.currentData,
            timestamp: Date.now(),
            mutationId: overlayId,
            overlayId,
            origin: 'local',
        });

        this.onEvent?.({
            type: 'local_patch',
            collection: this.collectionName,
            id: this.id,
            patch: patchRecord,
            timestamp: Date.now(),
        });

        // 5. Broadcast tentative overlay to other same-origin contexts (frame throttled)
        if (this.overlayChannel && !this.disposed) {
            this.overlayChannel.sendTentative(
                this.collectionName,
                this.id,
                this.localPendingPatch,
                overlayId
            );
        }

        // 6. Return commit Promise (resolves when committed to SQLite)
        return promise;
    }

    async patchPath<P extends NestedPath<T>>(path: P, value: PathValue<T, P>): Promise<void> {
        if (this.disposed) {
            throw new Error(`Cannot patch disposed LiveDocument '${this.id}'.`);
        }

        const pathStr = String(path);
        assertJsonSafe(value, pathStr);

        this.localPendingPathSets.push({ path: pathStr, value });
        this.remoteTentativePatch = null;
        this.remoteOverlayId = null;

        this.currentRev++;
        this.recomputeView(true);

        const { promise, overlayId } = this.commitScheduler.schedulePathSet(
            this.collectionName,
            this.id,
            pathStr,
            value,
            this.options
        );
        this.pendingOverlayIds.add(overlayId);

        const rootProp = pathStr.split('.')[0];
        const delta = deepFreeze(
            structuredClone({ [rootProp]: (this.currentData as any)[rootProp] })
        ) as Partial<T>;

        this.rawEngine.emitCDC({
            type: 'update',
            kind: 'update',
            collection: this.collectionName,
            id: this.id,
            rev: this.currentRev,
            delta,
            data: this.currentData,
            timestamp: Date.now(),
            mutationId: overlayId,
            overlayId,
            origin: 'local',
        });

        this.onEvent?.({
            type: 'local_patch',
            collection: this.collectionName,
            id: this.id,
            patch: { [pathStr]: value },
            timestamp: Date.now(),
        });

        return promise;
    }

    /**
     * Completely replaces the committed document data, rebasing any pending local patches on top.
     */
    async replace(value: T): Promise<void> {
        if (this.disposed) {
            throw new Error(`Cannot replace disposed LiveDocument '${this.id}'.`);
        }

        assertJsonSafe(value);
        this.committedData = deepFreeze(structuredClone(value)) as unknown as T;
        this.currentRev++;
        this.recomputeView(true);

        const docRecord = await this.rawEngine.updateDoc<T>(
            this.collectionName,
            this.id,
            value
        );
        this.committedRev = docRecord.rev;
    }

    async flush(): Promise<void> {
        if (this.disposed) {
            return;
        }
        await this.commitScheduler.flushDoc(this.collectionName, this.id);
    }

    onCommitSuccess(
        newRev: number,
        committedData: any,
        overlayId: string,
        committedPatch: Record<string, unknown>
    ): void {
        if (this.disposed) {
            return;
        }

        this.pendingOverlayIds.delete(overlayId);
        this.committedRev = newRev;
        this.committedData = deepFreeze(structuredClone(committedData)) as unknown as T;

        if (this.commitScheduler.hasPending(this.collectionName, this.id)) {
            this.localPendingPatch = this.commitScheduler.getPendingPatch(this.collectionName, this.id);
        } else {
            this.localPendingPatch = null;
            this.localPendingPathSets = [];
        }

        this.recomputeView(true);
    }

    onCommitError(failedPatch: Record<string, unknown>, err: unknown): void {
        if (this.disposed) {
            return;
        }

        if (this.commitScheduler.hasPending(this.collectionName, this.id)) {
            this.localPendingPatch = this.commitScheduler.getPendingPatch(this.collectionName, this.id);
        } else {
            this.localPendingPatch = null;
            this.localPendingPathSets = [];
        }

        this.recomputeView(true);

        const errorObj = err instanceof Error ? err : new Error(String(err));
        this.errorSubject.next(errorObj);
    }

    applyRemoteOverlay(patch: Record<string, unknown>, overlayId: string): void {
        if (this.disposed) {
            return;
        }

        // Local pending edits always take priority over remote tentative values
        if (this.localPendingPatch !== null) {
            return;
        }

        this.remoteTentativePatch = patch;
        this.remoteOverlayId = overlayId;
        this.recomputeView(true);
    }

    clearRemoteOverlay(overlayId: string): void {
        if (this.disposed) {
            return;
        }

        if (this.remoteOverlayId === overlayId) {
            this.remoteTentativePatch = null;
            this.remoteOverlayId = null;
            this.recomputeView(true);
        }
    }

    applyRemoteCommit(
        patch: Record<string, unknown> | undefined,
        rev: number | undefined,
        _overlayId: string
    ): void {
        if (this.disposed) {
            return;
        }

        this.remoteTentativePatch = null;
        this.remoteOverlayId = null;

        if (patch) {
            this.committedData = Object.freeze(
                jsonMergePatch<T>(this.committedData, patch as Partial<T>)
            ) as unknown as T;
        }

        if (rev !== undefined && rev > this.committedRev) {
            this.committedRev = rev;
        } else {
            this.committedRev++;
        }

        this.recomputeView(true);
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.cdcSubscription.unsubscribe();
        this.commitScheduler.unregisterDocument(this.collectionName, this.id);
        if (this.overlayChannel) {
            this.overlayChannel.unregisterDocument(this.collectionName, this.id);
        }
        this.stateSubject.complete();
        this.errorSubject.complete();
    }
}
