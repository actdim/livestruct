/**
 * @actdim/livestruct - LiveDocument Implementation
 * Reactive document with optimistic updates, echo suppression, MobX atom integration,
 * RFC 7396 merge patch, type-safe path mutations, and low-level engine escape hatch.
 */

import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { createAtom, type IAtom } from 'mobx';
import type { LiveEngineAccess, LiveSqliteEngine } from '../engine/index';
import { jsonMergePatch } from '../engine/patch';
import type { NestedPath, PathValue } from '../lens/index';
import type { LiveDocument, PatchPayload } from './types';
import { buildPathPatch } from './patchHelper';

export class LiveDocumentImpl<T extends object = Record<string, any>>
    implements LiveDocument<T>
{
    readonly id: string;
    readonly collectionName: string;
    readonly engine: LiveEngineAccess<T>;

    private readonly rawEngine: LiveSqliteEngine;
    private currentData: T;
    private currentRev: number;
    private committedRev: number;
    private readonly stateSubject: BehaviorSubject<Readonly<T>>;
    private readonly cdcSubscription: Subscription;
    private readonly pendingMutationIds = new Set<string>();
    private mutationCounter = 0;
    private readonly atom: IAtom;
    private disposed = false;

    constructor(
        collectionName: string,
        id: string,
        initialData: T,
        initialRev: number,
        rawEngine: LiveSqliteEngine,
        engineAccess: LiveEngineAccess<T>
    ) {
        this.collectionName = collectionName;
        this.id = id;
        this.rawEngine = rawEngine;
        this.engine = engineAccess;
        this.currentRev = initialRev;
        this.committedRev = initialRev;
        this.currentData = Object.freeze(jsonMergePatch<T>({}, initialData)) as unknown as T;
        this.stateSubject = new BehaviorSubject<Readonly<T>>(this.currentData);

        this.atom = createAtom(
            `LiveDocument:${collectionName}:${id}`,
            () => {},
            () => {}
        );

        // Subscribe to CDC stream with echo suppression and external change merging
        this.cdcSubscription = this.engine.cdc$
            .pipe(filter((event) => event.id === this.id))
            .subscribe((event) => {
                this.handleCDCEvent(event);
            });
    }

    private handleCDCEvent(event: {
        type: 'insert' | 'update' | 'delete';
        id: string;
        delta: Partial<T>;
        mutationId?: string;
    }): void {
        if (this.disposed) {
            return;
        }

        // Echo suppression: if event carries our pending mutation ID, suppress duplicate emission
        if (event.mutationId && this.pendingMutationIds.has(event.mutationId)) {
            this.pendingMutationIds.delete(event.mutationId);
            return;
        }

        if (event.type === 'delete') {
            this.dispose();
            return;
        }

        if (event.type === 'update' || event.type === 'insert') {
            if (this.pendingMutationIds.size > 0) {
                // In-flight local mutations exist: merge external delta into current data without wiping uncommitted fields
                const merged = jsonMergePatch<T>(this.currentData, event.delta);
                this.currentData = Object.freeze(merged) as unknown as T;
                this.stateSubject.next(this.currentData);
                this.atom.reportChanged();
            } else {
                // No in-flight local mutations: fetch latest authoritative snapshot from engine
                this.rawEngine.getDoc<T>(this.collectionName, this.id).then((doc) => {
                    if (doc && !this.disposed) {
                        if (doc.rev > this.committedRev) {
                            this.committedRev = doc.rev;
                            this.currentRev = doc.rev;
                            this.currentData = Object.freeze(doc.data) as unknown as T;
                            this.stateSubject.next(this.currentData);
                            this.atom.reportChanged();
                        }
                    }
                });
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

    get isDisposed(): boolean {
        return this.disposed;
    }

    async patch(partial: PatchPayload<T>): Promise<void> {
        if (this.disposed) {
            throw new Error(`Cannot patch disposed LiveDocument '${this.id}'.`);
        }

        const mutationId = `mut_${this.id}_${Date.now()}_${++this.mutationCounter}`;
        this.pendingMutationIds.add(mutationId);

        // Optimistic local update
        const previousData = this.currentData;
        const previousRev = this.currentRev;
        const optimisticData = Object.freeze(jsonMergePatch<T>(this.currentData, partial)) as unknown as T;

        this.currentData = optimisticData;
        this.currentRev = this.currentRev + 1;
        this.stateSubject.next(this.currentData);
        this.atom.reportChanged();

        try {
            const updated = await this.rawEngine.patchDoc<T>(
                this.collectionName,
                this.id,
                partial,
                undefined,
                mutationId
            );
            this.committedRev = updated.rev;
            // Clean up mutation ID if CDC event arrived or if it was already processed
            this.pendingMutationIds.delete(mutationId);
        } catch (err) {
            // Rollback optimistic update on failure
            this.pendingMutationIds.delete(mutationId);
            this.currentData = previousData;
            this.currentRev = previousRev;
            this.stateSubject.next(this.currentData);
            this.atom.reportChanged();
            throw err;
        }
    }

    async patchPath<P extends NestedPath<T>>(path: P, value: PathValue<T, P>): Promise<void> {
        if (this.disposed) {
            throw new Error(`Cannot patch disposed LiveDocument '${this.id}'.`);
        }
        const patch = buildPathPatch(this.currentData, path, value);
        await this.patch(patch as PatchPayload<T>);
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.cdcSubscription.unsubscribe();
        this.pendingMutationIds.clear();
        this.stateSubject.complete();
    }
}
