import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { initCadStore, type CadStore } from '../src/cad/store';
import { TelemetryMonitor } from '../src/components/TelemetryMonitor';
import {
    calculatePayloadSize,
    calculateThroughput,
    extractUpdatedFields,
    filterTelemetryEvents,
    type TelemetryEvent,
} from '../src/telemetry/types';
import { CAD_DRAG_CHANNEL } from '../src/cad/types';

describe('Telemetry & Protocol Monitor', () => {
    let store: CadStore;

    beforeEach(async () => {
        store = await initCadStore({
            name: 'test_telemetry_' + Math.random().toString(36).substring(2, 9),
            forceMemory: true,
        });
    });

    afterEach(async () => {
        await store.close();
    });

    describe('REQ-1: Event Categorization & Colored Badges', () => {
        it('renders green badge [RAM 60fps] for ephemeral RAM bus events with microsecond latency', () => {
            const ephemeralEvent: TelemetryEvent = {
                id: 'eph-test-1',
                timestamp: Date.now(),
                category: 'ephemeral',
                channel: 'cad.cursor.drag',
                latencyUs: 42,
                payloadSummary: 'shapeId: rect-1 (dx: 10, dy: 5)',
            };

            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(TelemetryMonitor, {
                    cadStore: store,
                    initialEvents: [ephemeralEvent],
                })
            );

            expect(html).toContain('data-testid="badge-ephemeral"');
            expect(html).toContain('[RAM 60fps]');
            expect(html).toContain('42 us latency');
            expect(html).toContain('cad.cursor.drag');
            expect(html).toContain('shapeId: rect-1 (dx: 10, dy: 5)');
        });

        it('renders blue badge [SQLITE COMMIT] for SQLite commits with size and updated fields', () => {
            const sqliteEvent: TelemetryEvent = {
                id: 'sql-test-1',
                timestamp: Date.now(),
                category: 'sqlite',
                channel: 'sqlite.commit',
                sizeBytes: 128,
                updatedFields: ['shapes.rect-1.x', 'shapes.rect-1.y'],
                rev: 2,
                payloadSummary: 'rev: 2 | 128 B | fields: [shapes.rect-1.x, shapes.rect-1.y]',
            };

            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(TelemetryMonitor, {
                    cadStore: store,
                    initialEvents: [sqliteEvent],
                })
            );

            expect(html).toContain('data-testid="badge-sqlite"');
            expect(html).toContain('[SQLITE COMMIT]');
            expect(html).toContain('128 B');
            expect(html).toContain('fields: [shapes.rect-1.x, shapes.rect-1.y]');
            expect(html).toContain('rev: 2');
            expect(html).toContain('sqlite.commit');
        });

        it('renders orange badge [CDC REPLICA] for cross-tab CDC incoming events with origin and timestamp', () => {
            const cdcTimestamp = 1700000000000;
            const cdcEvent: TelemetryEvent = {
                id: 'cdc-test-1',
                timestamp: cdcTimestamp,
                category: 'cdc',
                channel: 'cdc.replica',
                origin: 'tab-2',
                updatedFields: ['shapes.circle-1'],
                sizeBytes: 74,
                payloadSummary: 'delta from tab-2 | size: 74 B | fields: [shapes.circle-1]',
            };

            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(TelemetryMonitor, {
                    cadStore: store,
                    initialEvents: [cdcEvent],
                })
            );

            expect(html).toContain('data-testid="badge-cdc"');
            expect(html).toContain('[CDC REPLICA]');
            expect(html).toContain('origin: tab-2');
            expect(html).toContain('cdc.replica');
            expect(html).toContain(new Date(cdcTimestamp).toLocaleTimeString());
        });
    });

    describe('REQ-2: Throughput Metrics Calculation & Display', () => {
        it('calculates throughput correctly in rolling time window', () => {
            const now = 10000;
            const windowMs = 1000;

            // 5 events within the last 1000ms
            const timestamps = [9100, 9250, 9500, 9800, 10000];
            const rate = calculateThroughput(timestamps, windowMs, now);
            expect(rate).toBe(5);

            // Events older than window are excluded
            const timestampsWithStale = [5000, 7000, 8500, 9200, 9600, 10000];
            const filteredRate = calculateThroughput(timestampsWithStale, windowMs, now);
            expect(filteredRate).toBe(3);

            // Empty timestamps returns 0
            expect(calculateThroughput([], windowMs, now)).toBe(0);

            // Invalid window returns 0
            expect(calculateThroughput(timestamps, 0, now)).toBe(0);
        });

        it('displays throughput, disk writes, and categorized counts in metrics bar', () => {
            const testEvents: TelemetryEvent[] = [
                {
                    id: 'e-1',
                    timestamp: Date.now(),
                    category: 'ephemeral',
                    channel: 'cad.cursor.drag',
                    payloadSummary: 'drag',
                },
                {
                    id: 'e-2',
                    timestamp: Date.now(),
                    category: 'ephemeral',
                    channel: 'cad.cursor.drag',
                    payloadSummary: 'drag',
                },
                {
                    id: 's-1',
                    timestamp: Date.now(),
                    category: 'sqlite',
                    channel: 'sqlite.commit',
                    payloadSummary: 'commit',
                },
                {
                    id: 'c-1',
                    timestamp: Date.now(),
                    category: 'cdc',
                    channel: 'cdc.replica',
                    payloadSummary: 'replica',
                },
            ];

            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(TelemetryMonitor, {
                    cadStore: store,
                    initialEvents: testEvents,
                })
            );

            expect(html).toContain('data-testid="telemetry-metrics-bar"');
            expect(html).toContain('data-testid="metric-ram-events"');
            expect(html).toContain('data-testid="metric-sqlite-commits"');
            expect(html).toContain('data-testid="metric-cdc-events"');
            expect(html).toContain('data-testid="metric-total-events"');
            expect(html).toContain('>4</div>'); // Total Events: 4
            expect(html).toContain('>2</div>'); // RAM Events: 2
            expect(html).toContain('>1</div>'); // CDC Events: 1
        });
    });

    describe('REQ-3: Channel Prefix & Query Filtering', () => {
        const sampleEvents: TelemetryEvent[] = [
            {
                id: 'e-1',
                timestamp: 1000,
                category: 'ephemeral',
                channel: 'cad.cursor.drag',
                payloadSummary: 'shape rect-1 dragged',
            },
            {
                id: 'e-2',
                timestamp: 1001,
                category: 'ephemeral',
                channel: 'cad.viewport.pan',
                payloadSummary: 'viewport panned',
            },
            {
                id: 's-1',
                timestamp: 1002,
                category: 'sqlite',
                channel: 'sqlite.commit',
                updatedFields: ['shapes.rect-1.fill'],
                payloadSummary: 'commit fill color',
            },
            {
                id: 'c-1',
                timestamp: 1003,
                category: 'cdc',
                channel: 'cdc.replica',
                origin: 'tab-remote',
                payloadSummary: 'cross-tab replication',
            },
        ];

        it('returns all events when query is ALL or empty', () => {
            expect(filterTelemetryEvents(sampleEvents, 'ALL').length).toBe(4);
            expect(filterTelemetryEvents(sampleEvents, '').length).toBe(4);
            expect(filterTelemetryEvents(sampleEvents, '*').length).toBe(4);
        });

        it('filters specifically by cad.* channel prefix', () => {
            const cadEvents = filterTelemetryEvents(sampleEvents, 'cad.*');
            expect(cadEvents.length).toBe(2);
            expect(cadEvents.every((e) => e.channel.startsWith('cad.'))).toBe(true);
        });

        it('filters specifically by sqlite.* channel prefix', () => {
            const sqliteEvents = filterTelemetryEvents(sampleEvents, 'sqlite.*');
            expect(sqliteEvents.length).toBe(1);
            expect(sqliteEvents[0].channel).toBe('sqlite.commit');
        });

        it('filters specifically by cdc.* channel prefix', () => {
            const cdcEvents = filterTelemetryEvents(sampleEvents, 'cdc.*');
            expect(cdcEvents.length).toBe(1);
            expect(cdcEvents[0].channel).toBe('cdc.replica');
        });

        it('filters by text search in payload or fields', () => {
            const fillMatches = filterTelemetryEvents(sampleEvents, 'fill');
            expect(fillMatches.length).toBe(1);
            expect(fillMatches[0].id).toBe('s-1');

            const originMatches = filterTelemetryEvents(sampleEvents, 'tab-remote');
            expect(originMatches.length).toBe(1);
            expect(originMatches[0].id).toBe('c-1');
        });

        it('renders filter buttons for ALL, cad.*, sqlite.*, and cdc.*', () => {
            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(TelemetryMonitor, {
                    cadStore: store,
                    initialEvents: sampleEvents,
                })
            );

            expect(html).toContain('data-testid="filter-btn-all"');
            expect(html).toContain('data-testid="filter-btn-cad"');
            expect(html).toContain('data-testid="filter-btn-sqlite"');
            expect(html).toContain('data-testid="filter-btn-cdc"');
            expect(html).toContain('data-testid="telemetry-filter-input"');
        });
    });

    describe('Payload Size & Updated Fields Extraction', () => {
        it('extracts leaf property paths accurately from nested delta', () => {
            const delta = {
                shapes: {
                    'rect-1': {
                        x: 120,
                        y: 80,
                    },
                },
                selectedShapeId: 'rect-1',
            };

            const fields = extractUpdatedFields(delta);
            expect(fields).toContain('shapes.rect-1.x');
            expect(fields).toContain('shapes.rect-1.y');
            expect(fields).toContain('selectedShapeId');
        });

        it('calculates JSON UTF-8 byte size accurately', () => {
            const payload = { x: 100, y: 200 };
            const size = calculatePayloadSize(payload);
            const expected = new TextEncoder().encode(JSON.stringify(payload)).length;
            expect(size).toBe(expected);
            expect(size).toBeGreaterThan(0);

            expect(calculatePayloadSize(null)).toBe(0);
            expect(calculatePayloadSize(undefined)).toBe(0);
        });
    });

    describe('Live CadStore Integration & Event Subscriptions', () => {
        it('captures green ephemeral events from livestruct doc.patch', async () => {
            const receivedEvents: TelemetryEvent[] = [];
            const sub = store.liveStore.events$.subscribe((evt) => {
                if (evt.type === 'local_patch') {
                    receivedEvents.push({
                        id: 'lp-' + evt.timestamp,
                        timestamp: evt.timestamp,
                        category: 'ephemeral',
                        channel: 'livestruct.patch',
                        payloadSummary: 'patch on ' + evt.id,
                        rawPayload: evt.patch,
                    });
                }
            });

            // Simulate drag patch directly via doc.patch
            void store.doc.patch({
                shapes: {
                    'rect-1': {
                        x: 100,
                        y: 100,
                    },
                },
            });

            await new Promise((resolve) => setTimeout(resolve, 30));

            expect(receivedEvents.length).toBe(1);
            expect(receivedEvents[0].category).toBe('ephemeral');
            expect(receivedEvents[0].channel).toBe('livestruct.patch');
            expect(store.commits).toBe(0);

            sub.unsubscribe();
        });

        it('captures blue SQLite commit events with updated fields and byte size on doc.patch', async () => {
            const receivedCommits: TelemetryEvent[] = [];

            const sub = store.doc.engine.cdc$.subscribe((cdcEvent) => {
                const delta = (cdcEvent.delta || {}) as Record<string, unknown>;
                const fields = extractUpdatedFields(delta);
                const sizeBytes = calculatePayloadSize(delta);

                receivedCommits.push({
                    id: 'commit-' + Date.now(),
                    timestamp: Date.now(),
                    category: 'sqlite',
                    channel: 'sqlite.commit',
                    sizeBytes,
                    updatedFields: fields,
                    rev: store.diskCommitCount,
                    payloadSummary: 'fields: ' + fields.join(', '),
                    rawPayload: delta,
                });
            });

            await store.updateShapeProperties('rect-1', {
                fill: '#e11d48',
            });

            expect(receivedCommits.length).toBe(1);
            expect(receivedCommits[0].category).toBe('sqlite');
            expect(receivedCommits[0].channel).toBe('sqlite.commit');
            expect(receivedCommits[0].updatedFields).toContain('shapes.rect-1.fill');
            expect(receivedCommits[0].sizeBytes).toBeGreaterThan(0);
            expect(store.diskCommitCount).toBe(1);

            sub.unsubscribe();
        });
    });

    describe('Stream Controls and Simulation Buttons', () => {
        it('renders simulation buttons and stream controls in UI', () => {
            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(TelemetryMonitor, {
                    cadStore: store,
                })
            );

            expect(html).toContain('data-testid="simulate-ephemeral-drag"');
            expect(html).toContain('data-testid="simulate-sqlite-commit"');
            expect(html).toContain('data-testid="simulate-remote-cdc"');
            expect(html).toContain('data-testid="toggle-pause-stream"');
            expect(html).toContain('data-testid="clear-telemetry-log"');
            expect(html).toContain('data-testid="stream-status-badge"');
            expect(html).toContain('LIVE STREAM');
        });

        it('renders empty state placeholder when event list is empty', () => {
            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(TelemetryMonitor, {
                    cadStore: store,
                    initialEvents: [],
                })
            );

            expect(html).toContain('data-testid="telemetry-empty-state"');
            expect(html).toContain('No telemetry events');
        });
    });
});
