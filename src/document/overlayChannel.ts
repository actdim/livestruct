/**
 * @actdim/livestruct - OverlayChannel Implementation
 * Real-time BroadcastChannel distribution of uncommitted tentative values across same-origin contexts.
 * Features animation frame coalescing, TTL-based cleanup, and commit-matching drop semantics.
 */

import { jsonMergePatch } from '../engine/patch';
import { makeDocKey } from '../engine/schema';
import type { LiveStructEvent } from './types';

export interface OverlayMessage {
    readonly type: 'overlay';
    readonly collection: string;
    readonly id: string;
    readonly patch: Record<string, unknown>;
    readonly overlayId: string;
    readonly senderSessionId: string;
    readonly timestamp: number;
}

export interface CommitMessage {
    readonly type: 'commit';
    readonly collection: string;
    readonly id: string;
    readonly overlayId: string;
    readonly patch?: Record<string, unknown>;
    readonly rev?: number;
    readonly senderSessionId: string;
    readonly timestamp: number;
}

export type OverlayChannelMessage = OverlayMessage | CommitMessage;

export interface OverlayDocumentTarget {
    applyRemoteOverlay(patch: Record<string, unknown>, overlayId: string): void;
    clearRemoteOverlay(overlayId: string): void;
    applyRemoteCommit?(
        patch: Record<string, unknown> | undefined,
        rev: number | undefined,
        overlayId: string
    ): void;
}

export interface OverlayChannelOptions {
    storeId: string;
    sessionId?: string;
    overlayTtlMs?: number; // default: 1500
    disabled?: boolean;
    onEvent?: (event: LiveStructEvent) => void;
}

interface ReceivedOverlayEntry {
    readonly collection: string;
    readonly id: string;
    readonly patch: Record<string, unknown>;
    readonly overlayId: string;
    lastSeen: number;
}

interface OutgoingPendingEntry {
    readonly collection: string;
    readonly id: string;
    patch: Record<string, unknown>;
    overlayId: string;
}

export class OverlayChannel {
    readonly storeId: string;
    readonly sessionId: string;
    readonly overlayTtlMs: number;
    private readonly disabled: boolean;
    private readonly onEvent?: (event: LiveStructEvent) => void;

    private channel: BroadcastChannel | null = null;
    private readonly registeredDocs = new Map<string, OverlayDocumentTarget>();
    private readonly receivedOverlays = new Map<string, ReceivedOverlayEntry>();
    private readonly outgoingPending = new Map<string, OutgoingPendingEntry>();

    private frameTimer: ReturnType<typeof setTimeout> | number | null = null;
    private ttlTimer: ReturnType<typeof setInterval> | number | null = null;
    private isDisposed = false;

    constructor(options: OverlayChannelOptions) {
        this.storeId = options.storeId;
        this.sessionId = options.sessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        this.overlayTtlMs = options.overlayTtlMs ?? 1500;
        this.disabled = options.disabled ?? false;
        this.onEvent = options.onEvent;

        if (!this.disabled && typeof BroadcastChannel !== 'undefined') {
            try {
                this.channel = new BroadcastChannel(`livestruct:${this.storeId}:overlay`);
                this.channel.onmessage = (event: MessageEvent) => {
                    this.handleIncomingMessage(event.data);
                };
            } catch {
                this.channel = null;
            }
        }
    }

    /**
     * Registers a document to receive remote tentative overlays.
     */
    registerDocument(collection: string, id: string, doc: OverlayDocumentTarget): void {
        const key = makeDocKey(collection, id);
        this.registeredDocs.set(key, doc);

        // If an active tentative overlay is already stored for this document, apply it immediately
        const existing = this.receivedOverlays.get(key);
        if (existing) {
            doc.applyRemoteOverlay(existing.patch, existing.overlayId);
        }
    }

    /**
     * Unregisters a document.
     */
    unregisterDocument(collection: string, id: string): void {
        const key = makeDocKey(collection, id);
        this.registeredDocs.delete(key);
    }

    /**
     * Queues a tentative patch to be broadcast on the next animation frame.
     */
    sendTentative(
        collection: string,
        id: string,
        patch: Record<string, unknown>,
        overlayId: string
    ): void {
        if (this.disabled || this.isDisposed || !this.channel) {
            return;
        }

        const key = makeDocKey(collection, id);
        const existing = this.outgoingPending.get(key);
        if (existing) {
            existing.patch = jsonMergePatch<Record<string, unknown>>(existing.patch, patch);
            existing.overlayId = overlayId;
        } else {
            this.outgoingPending.set(key, {
                collection,
                id,
                patch: jsonMergePatch<Record<string, unknown>>({}, patch),
                overlayId,
            });
        }

        this.scheduleFrame();
    }

    private scheduleFrame(): void {
        if (this.frameTimer !== null) {
            return;
        }

        if (typeof requestAnimationFrame === 'function') {
            this.frameTimer = requestAnimationFrame(() => {
                this.frameTimer = null;
                this.flushOutgoing();
            });
        } else {
            this.frameTimer = setTimeout(() => {
                this.frameTimer = null;
                this.flushOutgoing();
            }, 16);
        }
    }

    /**
     * Flushes queued outgoing tentative messages immediately.
     */
    flushOutgoing(): void {
        if (this.outgoingPending.size === 0 || !this.channel || this.isDisposed) {
            return;
        }

        const now = Date.now();
        for (const entry of this.outgoingPending.values()) {
            const message: OverlayMessage = {
                type: 'overlay',
                collection: entry.collection,
                id: entry.id,
                patch: entry.patch,
                overlayId: entry.overlayId,
                senderSessionId: this.sessionId,
                timestamp: now,
            };
            try {
                this.channel.postMessage(message);
                this.onEvent?.({
                    type: 'overlay_sent',
                    collection: entry.collection,
                    id: entry.id,
                    overlayId: entry.overlayId,
                    patch: entry.patch,
                    timestamp: now,
                });
            } catch {
                // Ignore serialization or transmission errors
            }
        }
        this.outgoingPending.clear();
    }

    /**
     * Broadcasts a committed patch to same-origin contexts so tentative overlays are dropped
     * and final committed values are restored synchronously across tabs/iframes.
     */
    broadcastCommit(
        collection: string,
        id: string,
        overlayId: string,
        patch?: Record<string, unknown>,
        rev?: number
    ): void {
        if (this.disabled || this.isDisposed || !this.channel) {
            return;
        }

        const docKey = makeDocKey(collection, id);
        this.outgoingPending.delete(docKey);

        const now = Date.now();
        const message: CommitMessage = {
            type: 'commit',
            collection,
            id,
            overlayId,
            patch,
            rev,
            senderSessionId: this.sessionId,
            timestamp: now,
        };

        try {
            this.channel.postMessage(message);
        } catch {
            // Ignore serialization or transmission errors
        }
    }

    private handleIncomingMessage(rawMessage: unknown): void {
        if (this.isDisposed || !rawMessage || typeof rawMessage !== 'object') {
            return;
        }

        const message = rawMessage as OverlayChannelMessage;

        // Ignore messages originating from self
        if (message.senderSessionId === this.sessionId) {
            return;
        }

        if (message.type === 'commit') {
            const key = makeDocKey(message.collection, message.id);
            this.receivedOverlays.delete(key);

            const target = this.registeredDocs.get(key);
            if (target) {
                if (typeof target.applyRemoteCommit === 'function') {
                    target.applyRemoteCommit(message.patch, message.rev, message.overlayId);
                } else {
                    target.clearRemoteOverlay(message.overlayId);
                }
            }

            this.onEvent?.({
                type: 'remote_commit',
                collection: message.collection,
                id: message.id,
                rev: message.rev ?? 1,
                overlayId: message.overlayId,
                origin: 'remote',
                patch: message.patch ?? {},
                timestamp: message.timestamp || Date.now(),
            });

            return;
        }

        if (message.type !== 'overlay') {
            return;
        }

        const key = makeDocKey(message.collection, message.id);
        const existing = this.receivedOverlays.get(key);

        let mergedPatch: Record<string, unknown>;
        if (existing && existing.overlayId === message.overlayId) {
            mergedPatch = jsonMergePatch<Record<string, unknown>>(existing.patch, message.patch);
        } else {
            mergedPatch = jsonMergePatch<Record<string, unknown>>({}, message.patch);
        }

        this.receivedOverlays.set(key, {
            collection: message.collection,
            id: message.id,
            patch: mergedPatch,
            overlayId: message.overlayId,
            lastSeen: Date.now(),
        });

        const target = this.registeredDocs.get(key);
        if (target) {
            target.applyRemoteOverlay(mergedPatch, message.overlayId);
        }

        this.onEvent?.({
            type: 'overlay_received',
            collection: message.collection,
            id: message.id,
            overlayId: message.overlayId,
            patch: message.patch,
            senderSessionId: message.senderSessionId,
            timestamp: message.timestamp || Date.now(),
        });

        this.ensureTtlSweep();
    }

    /**
     * Drops received tentative overlay when a matching commit arrives.
     */
    dropOverlay(collection: string, id: string, overlayId?: string): void {
        const key = makeDocKey(collection, id);
        const existing = this.receivedOverlays.get(key);
        if (existing) {
            if (!overlayId || existing.overlayId === overlayId) {
                this.receivedOverlays.delete(key);
                const target = this.registeredDocs.get(key);
                if (target) {
                    target.clearRemoteOverlay(existing.overlayId);
                }
            }
        }

        if (this.receivedOverlays.size === 0 && this.ttlTimer !== null) {
            clearInterval(this.ttlTimer);
            this.ttlTimer = null;
        }
    }

    private ensureTtlSweep(): void {
        if (this.ttlTimer !== null || this.receivedOverlays.size === 0) {
            return;
        }
        // Check TTL periodically while overlays exist
        const interval = Math.max(50, Math.min(250, Math.floor(this.overlayTtlMs / 4)));
        this.ttlTimer = setInterval(() => {
            this.sweepExpiredOverlays();
        }, interval);
    }

    private sweepExpiredOverlays(): void {
        if (this.isDisposed) {
            return;
        }

        const now = Date.now();
        for (const [key, entry] of this.receivedOverlays.entries()) {
            if (now - entry.lastSeen > this.overlayTtlMs) {
                this.receivedOverlays.delete(key);
                const target = this.registeredDocs.get(key);
                if (target) {
                    target.clearRemoteOverlay(entry.overlayId);
                }
            }
        }

        if (this.receivedOverlays.size === 0 && this.ttlTimer !== null) {
            clearInterval(this.ttlTimer);
            this.ttlTimer = null;
        }
    }

    dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.isDisposed = true;

        if (this.frameTimer !== null) {
            if (typeof cancelAnimationFrame === 'function' && typeof this.frameTimer === 'number') {
                cancelAnimationFrame(this.frameTimer);
            } else {
                clearTimeout(this.frameTimer);
            }
            this.frameTimer = null;
        }

        if (this.ttlTimer !== null) {
            clearInterval(this.ttlTimer);
            this.ttlTimer = null;
        }

        this.outgoingPending.clear();
        this.receivedOverlays.clear();
        this.registeredDocs.clear();

        if (this.channel) {
            try {
                this.channel.close();
            } catch {
                // Ignore
            }
            this.channel = null;
        }
    }
}
