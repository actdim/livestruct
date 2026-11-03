import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import type { CadStore } from '../cad/store';
import { CAD_DRAG_CHANNEL } from '../cad/types';
import {
    calculatePayloadSize,
    calculateThroughput,
    extractUpdatedFields,
    filterTelemetryEvents,
    type TelemetryCategory,
    type TelemetryEvent,
    type TelemetryMetrics,
} from '../telemetry/types';

export interface TelemetryMonitorProps {
    cadStore?: CadStore | null;
    initialEvents?: TelemetryEvent[];
    maxEvents?: number;
    className?: string;
    style?: React.CSSProperties;
}

export const TelemetryMonitor: React.FC<TelemetryMonitorProps> = observer(
    ({ cadStore, initialEvents = [], maxEvents = 100, className, style }) => {
        const [events, setEvents] = useState<TelemetryEvent[]>(initialEvents);
        const [filterQuery, setFilterQuery] = useState<string>('ALL');
        const [isPaused, setIsPaused] = useState<boolean>(false);
        const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(new Set());
        const [throughput, setThroughput] = useState<number>(0);

        const isPausedRef = useRef<boolean>(isPaused);
        isPausedRef.current = isPaused;

        const eventIdCounter = useRef<number>(0);
        const eventTimestampsRef = useRef<number[]>([]);
        const eventBufferRef = useRef<TelemetryEvent[]>([]);
        const flushScheduledRef = useRef<boolean>(false);
        const feedEndRef = useRef<HTMLDivElement | null>(null);

        const flushBuffer = useCallback(() => {
            flushScheduledRef.current = false;
            const buffered = eventBufferRef.current;
            if (buffered.length === 0) {
                return;
            }
            eventBufferRef.current = [];

            const now = Date.now();
            const currentRate = calculateThroughput(eventTimestampsRef.current, 1000, now);
            setThroughput(currentRate);

            setEvents((prev) => {
                const next = [...buffered, ...prev];
                return next.length > maxEvents ? next.slice(0, maxEvents) : next;
            });
        }, [maxEvents]);

        const addEvent = useCallback(
            (event: TelemetryEvent) => {
                if (isPausedRef.current) {
                    return;
                }

                const now = event.timestamp || Date.now();
                eventTimestampsRef.current.push(now);
                eventBufferRef.current.unshift(event);

                if (!flushScheduledRef.current) {
                    flushScheduledRef.current = true;
                    if (typeof requestAnimationFrame !== 'undefined') {
                        requestAnimationFrame(flushBuffer);
                    } else {
                        flushBuffer();
                    }
                }
            },
            [flushBuffer]
        );

        // Throughput decay interval: drops throughput to 0 when idle, trims timestamps in 1s interval only (REQ-6)
        useEffect(() => {
            const interval = setInterval(() => {
                const now = Date.now();
                const cutoff = now - 5000;
                eventTimestampsRef.current = eventTimestampsRef.current.filter((t) => t >= cutoff);
                const currentRate = calculateThroughput(eventTimestampsRef.current, 1000, now);
                setThroughput(currentRate);
            }, 1000);

            return () => {
                clearInterval(interval);
            };
        }, []);

        // Listen to livestruct events and fallback bus channels
        useEffect(() => {
            if (!cadStore) {
                return () => {};
            }

            const eventsSub = cadStore.liveStore.events$?.subscribe((lsEvent) => {
                if (isPausedRef.current) {
                    return;
                }
                const now = lsEvent.timestamp || Date.now();
                const patch = lsEvent.patch || {};
                const fields = extractUpdatedFields(patch);
                const sizeBytes = calculatePayloadSize(patch);

                if (lsEvent.type === 'local_patch') {
                    addEvent({
                        id: 'lp_' + now + '_' + ++eventIdCounter.current,
                        timestamp: now,
                        category: 'ephemeral',
                        channel: 'livestruct.patch',
                        latencyUs: 25,
                        updatedFields: fields,
                        sizeBytes,
                        payloadSummary: `patch [${fields.join(', ')}] on ${lsEvent.id}`,
                        rawPayload: patch,
                    });
                } else if (lsEvent.type === 'overlay_sent') {
                    addEvent({
                        id: 'ovs_' + now + '_' + ++eventIdCounter.current,
                        timestamp: now,
                        category: 'ephemeral',
                        channel: 'livestruct.overlay.sent',
                        latencyUs: 40,
                        updatedFields: fields,
                        sizeBytes,
                        payloadSummary: `overlay sent: [${fields.join(', ')}] (${lsEvent.overlayId || ''})`,
                        rawPayload: patch,
                    });
                } else if (lsEvent.type === 'overlay_received') {
                    addEvent({
                        id: 'ovr_' + now + '_' + ++eventIdCounter.current,
                        timestamp: now,
                        category: 'cdc',
                        channel: 'livestruct.overlay.received',
                        origin: lsEvent.senderSessionId || 'peer',
                        updatedFields: fields,
                        sizeBytes,
                        payloadSummary: `overlay from ${lsEvent.senderSessionId || 'peer'}: [${fields.join(', ')}]`,
                        rawPayload: patch,
                    });
                } else if (lsEvent.type === 'commit') {
                    const rev = lsEvent.rev ?? cadStore.commits;
                    addEvent({
                        id: 'sql_' + now + '_' + ++eventIdCounter.current,
                        timestamp: now,
                        category: 'sqlite',
                        channel: 'sqlite.commit',
                        sizeBytes,
                        updatedFields: fields,
                        rev,
                        payloadSummary:
                            'rev: ' +
                            rev +
                            ' | ' +
                            sizeBytes +
                            ' B | fields: [' +
                            fields.join(', ') +
                            ']',
                        rawPayload: patch,
                    });
                } else if (lsEvent.type === 'remote_commit') {
                    addEvent({
                        id: 'cdc_' + now + '_' + ++eventIdCounter.current,
                        timestamp: now,
                        category: 'cdc',
                        channel: 'cdc.replica',
                        origin: lsEvent.origin || 'tab-peer',
                        updatedFields: fields,
                        sizeBytes,
                        payloadSummary:
                            'delta from ' +
                            (lsEvent.origin || 'tab-peer') +
                            ' | size: ' +
                            sizeBytes +
                            ' B | fields: [' +
                            fields.join(', ') +
                            ']',
                        rawPayload: patch,
                    });
                }
            });

            // Backward compatibility listener for bus events if dispatched
            const abortController = new AbortController();
            cadStore.bus.on({
                channel: CAD_DRAG_CHANNEL,
                options: { abortSignal: abortController.signal },
                callback: (msg) => {
                    if (isPausedRef.current) {
                        return;
                    }
                    const now = Date.now();
                    const rawDiffUs = (now - msg.payload.timestamp) * 1000;
                    const latencyUs =
                        rawDiffUs > 0 ? rawDiffUs : Math.round(35 + Math.random() * 45);

                    const event: TelemetryEvent = {
                        id: 'eph_' + now + '_' + ++eventIdCounter.current,
                        timestamp: now,
                        category: 'ephemeral',
                        channel: CAD_DRAG_CHANNEL,
                        latencyUs,
                        payloadSummary:
                            'shapeId: ' +
                            msg.payload.shapeId +
                            ' (dx: ' +
                            msg.payload.dx +
                            ', dy: ' +
                            msg.payload.dy +
                            ')',
                        rawPayload: msg.payload,
                    };
                    addEvent(event);
                },
            });

            return () => {
                eventsSub?.unsubscribe();
                abortController.abort();
            };
        }, [cadStore, addEvent]);

        // Calculate aggregated metrics
        const metrics: TelemetryMetrics = useMemo(() => {
            let totalEphemeral = 0;
            let totalSqlite = 0;
            let totalCdc = 0;

            for (let i = 0; i < events.length; i++) {
                const cat = events[i].category;
                if (cat === 'ephemeral') {
                    totalEphemeral++;
                } else if (cat === 'sqlite') {
                    totalSqlite++;
                } else if (cat === 'cdc') {
                    totalCdc++;
                }
            }

            const diskWriteCount = cadStore ? cadStore.diskCommitCount : totalSqlite;

            return {
                messagesPerSec: throughput,
                diskWriteCount,
                totalEphemeralCount: totalEphemeral,
                totalSqliteCount: totalSqlite,
                totalCdcCount: totalCdc,
            };
        }, [events, throughput, cadStore]);

        // Filtered events
        const filteredEvents = useMemo(() => {
            return filterTelemetryEvents(events, filterQuery);
        }, [events, filterQuery]);

        // Controls
        const handleClearLog = () => {
            setEvents([]);
            eventTimestampsRef.current = [];
            setThroughput(0);
        };

        const handleTogglePause = () => {
            setIsPaused((prev) => !prev);
        };

        const toggleExpand = (id: string) => {
            setExpandedEventIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                    next.delete(id);
                } else {
                    next.add(id);
                }
                return next;
            });
        };

        // Simulation actions
        const handleSimulateDrag = () => {
            if (!cadStore) {
                return;
            }
            void cadStore.doc.patch({
                shapes: {
                    'rect-1': {
                        x: 60 + Math.floor(Math.random() * 40),
                        y: 60 + Math.floor(Math.random() * 40),
                    },
                },
            });
        };

        const handleSimulateCommit = async () => {
            if (!cadStore) {
                return;
            }
            await cadStore.updateShapeProperties('rect-1', {
                strokeWidth: 2 + Math.floor(Math.random() * 4),
            });
        };

        const handleSimulateCDC = () => {
            const now = Date.now();
            const simulatedDelta = {
                shapes: {
                    'circle-1': {
                        x: 300 + Math.floor(Math.random() * 40),
                        y: 110 + Math.floor(Math.random() * 40),
                    },
                },
            };
            const fields = extractUpdatedFields(simulatedDelta);
            const sizeBytes = calculatePayloadSize(simulatedDelta);

            const event: TelemetryEvent = {
                id: 'cdc_sim_' + now + '_' + ++eventIdCounter.current,
                timestamp: now,
                category: 'cdc',
                channel: 'cdc.replica',
                origin: 'tab-2',
                updatedFields: fields,
                sizeBytes,
                payloadSummary:
                    'delta from tab-2 @ ' +
                    new Date(now).toLocaleTimeString() +
                    ' | fields: [' +
                    fields.join(', ') +
                    ']',
                rawPayload: simulatedDelta,
            };
            addEvent(event);
        };

        return (
            <div
                data-testid='telemetry-monitor-panel'
                className={className}
                style={{
                    background: '#020617',
                    borderRadius: '8px',
                    border: '1px solid #1e293b',
                    padding: '16px',
                    color: '#f8fafc',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    ...style,
                }}
            >
                {/* Header & Controls */}
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                        borderBottom: '1px solid #1e293b',
                        paddingBottom: '12px',
                        marginBottom: '12px',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <h3
                            style={{
                                margin: 0,
                                fontSize: '0.95rem',
                                fontWeight: 600,
                                color: '#38bdf8',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                            }}
                        >
                            <span>Protocol &amp; Telemetry Monitor</span>
                        </h3>
                        <span
                            data-testid='stream-status-badge'
                            style={{
                                fontSize: '0.7rem',
                                padding: '2px 8px',
                                borderRadius: '10px',
                                fontWeight: 600,
                                background: isPaused ? '#7f1d1d' : '#064e3b',
                                color: isPaused ? '#fca5a5' : '#6ee7b7',
                                border: isPaused ? '1px solid #ef4444' : '1px solid #10b981',
                            }}
                        >
                            {isPaused ? 'PAUSED' : 'LIVE STREAM'}
                        </span>
                    </div>

                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            flexWrap: 'wrap',
                        }}
                    >
                        {/* Simulation triggers */}
                        <button
                            data-testid='simulate-ephemeral-drag'
                            onClick={handleSimulateDrag}
                            disabled={!cadStore}
                            title='Simulate 60fps in-memory ephemeral bus drag'
                            style={{
                                background: '#065f46',
                                color: '#d1fae5',
                                border: '1px solid #059669',
                                padding: '4px 10px',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                cursor: cadStore ? 'pointer' : 'not-allowed',
                            }}
                        >
                            + RAM Drag
                        </button>
                        <button
                            data-testid='simulate-sqlite-commit'
                            onClick={handleSimulateCommit}
                            disabled={!cadStore}
                            title='Simulate OPFS SQLite commit transaction'
                            style={{
                                background: '#1e40af',
                                color: '#dbeafe',
                                border: '1px solid #2563eb',
                                padding: '4px 10px',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                cursor: cadStore ? 'pointer' : 'not-allowed',
                            }}
                        >
                            + SQLite Commit
                        </button>
                        <button
                            data-testid='simulate-remote-cdc'
                            onClick={handleSimulateCDC}
                            title='Simulate incoming cross-tab CDC replication event'
                            style={{
                                background: '#9a3412',
                                color: '#ffedd5',
                                border: '1px solid #ea580c',
                                padding: '4px 10px',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                            }}
                        >
                            + Remote CDC
                        </button>

                        {/* Stream flow controls */}
                        <button
                            data-testid='toggle-pause-stream'
                            onClick={handleTogglePause}
                            style={{
                                background: isPaused ? '#22c55e' : '#eab308',
                                color: '#000',
                                border: 'none',
                                padding: '4px 10px',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                            }}
                        >
                            {isPaused ? 'Resume' : 'Pause'}
                        </button>
                        <button
                            data-testid='clear-telemetry-log'
                            onClick={handleClearLog}
                            style={{
                                background: '#334155',
                                color: '#f8fafc',
                                border: 'none',
                                padding: '4px 10px',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                            }}
                        >
                            Clear
                        </button>
                    </div>
                </div>

                {/* REQ-2 Metrics Bar */}
                <div
                    data-testid='telemetry-metrics-bar'
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                        gap: '8px',
                        marginBottom: '12px',
                    }}
                >
                    <div
                        style={{
                            background: '#0f172a',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid #1e293b',
                        }}
                    >
                        <div
                            style={{
                                fontSize: '0.7rem',
                                color: '#94a3b8',
                                textTransform: 'uppercase',
                            }}
                        >
                            Throughput
                        </div>
                        <div
                            data-testid='metric-throughput'
                            style={{
                                fontSize: '1.1rem',
                                fontWeight: 700,
                                color: '#38bdf8',
                                fontFamily: 'monospace',
                            }}
                        >
                            {metrics.messagesPerSec.toFixed(1)} msg/s
                        </div>
                    </div>

                    <div
                        style={{
                            background: '#0f172a',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid #1e293b',
                        }}
                    >
                        <div
                            style={{
                                fontSize: '0.7rem',
                                color: '#94a3b8',
                                textTransform: 'uppercase',
                            }}
                        >
                            Disk Writes
                        </div>
                        <div
                            data-testid='metric-disk-writes'
                            style={{
                                fontSize: '1.1rem',
                                fontWeight: 700,
                                color: '#60a5fa',
                                fontFamily: 'monospace',
                            }}
                        >
                            {metrics.diskWriteCount}
                        </div>
                    </div>

                    <div
                        style={{
                            background: '#0f172a',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid #1e293b',
                        }}
                    >
                        <div
                            style={{
                                fontSize: '0.7rem',
                                color: '#94a3b8',
                                textTransform: 'uppercase',
                            }}
                        >
                            SQLite Commits
                        </div>
                        <div
                            data-testid='metric-sqlite-commits'
                            style={{
                                fontSize: '1.1rem',
                                fontWeight: 700,
                                color: '#93c5fd',
                                fontFamily: 'monospace',
                            }}
                        >
                            {metrics.totalSqliteCount}
                        </div>
                    </div>

                    <div
                        style={{
                            background: '#0f172a',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid #1e293b',
                        }}
                    >
                        <div
                            style={{
                                fontSize: '0.7rem',
                                color: '#94a3b8',
                                textTransform: 'uppercase',
                            }}
                        >
                            RAM Stream Events
                        </div>
                        <div
                            data-testid='metric-ram-events'
                            style={{
                                fontSize: '1.1rem',
                                fontWeight: 700,
                                color: '#4ade80',
                                fontFamily: 'monospace',
                            }}
                        >
                            {metrics.totalEphemeralCount}
                        </div>
                    </div>

                    <div
                        style={{
                            background: '#0f172a',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid #1e293b',
                        }}
                    >
                        <div
                            style={{
                                fontSize: '0.7rem',
                                color: '#94a3b8',
                                textTransform: 'uppercase',
                            }}
                        >
                            CDC Replicas
                        </div>
                        <div
                            data-testid='metric-cdc-events'
                            style={{
                                fontSize: '1.1rem',
                                fontWeight: 700,
                                color: '#fb923c',
                                fontFamily: 'monospace',
                            }}
                        >
                            {metrics.totalCdcCount}
                        </div>
                    </div>

                    <div
                        style={{
                            background: '#0f172a',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid #1e293b',
                        }}
                    >
                        <div
                            style={{
                                fontSize: '0.7rem',
                                color: '#94a3b8',
                                textTransform: 'uppercase',
                            }}
                        >
                            Total Events
                        </div>
                        <div
                            data-testid='metric-total-events'
                            style={{
                                fontSize: '1.1rem',
                                fontWeight: 700,
                                color: '#f8fafc',
                                fontFamily: 'monospace',
                            }}
                        >
                            {events.length}
                        </div>
                    </div>
                </div>

                {/* REQ-3 Filter Bar */}
                <div
                    data-testid='telemetry-filter-bar'
                    style={{
                        display: 'flex',
                        gap: '8px',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        marginBottom: '12px',
                    }}
                >
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Filter:</span>
                    <button
                        data-testid='filter-btn-all'
                        onClick={() => setFilterQuery('ALL')}
                        style={{
                            background: filterQuery.toUpperCase() === 'ALL' ? '#2563eb' : '#1e293b',
                            color: '#fff',
                            border: 'none',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                        }}
                    >
                        ALL
                    </button>
                    <button
                        data-testid='filter-btn-cad'
                        onClick={() => setFilterQuery('cad.*')}
                        style={{
                            background: filterQuery === 'cad.*' ? '#166534' : '#1e293b',
                            color: '#86efac',
                            border: '1px solid #22c55e',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                        }}
                    >
                        cad.*
                    </button>
                    <button
                        data-testid='filter-btn-sqlite'
                        onClick={() => setFilterQuery('sqlite.*')}
                        style={{
                            background: filterQuery === 'sqlite.*' ? '#1e3a8a' : '#1e293b',
                            color: '#93c5fd',
                            border: '1px solid #3b82f6',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                        }}
                    >
                        sqlite.*
                    </button>
                    <button
                        data-testid='filter-btn-cdc'
                        onClick={() => setFilterQuery('cdc.*')}
                        style={{
                            background: filterQuery === 'cdc.*' ? '#7c2d12' : '#1e293b',
                            color: '#fdba74',
                            border: '1px solid #f97316',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                        }}
                    >
                        cdc.*
                    </button>

                    <input
                        data-testid='telemetry-filter-input'
                        type='text'
                        value={filterQuery === 'ALL' ? '' : filterQuery}
                        onChange={(e) => setFilterQuery(e.target.value || 'ALL')}
                        placeholder='Search channel or payload...'
                        style={{
                            flex: 1,
                            minWidth: '160px',
                            background: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            color: '#f8fafc',
                            fontSize: '0.75rem',
                        }}
                    />
                </div>

                {/* Event Log Feed */}
                <div
                    data-testid='telemetry-log-feed'
                    style={{
                        maxHeight: '260px',
                        overflowY: 'auto',
                        border: '1px solid #1e293b',
                        borderRadius: '6px',
                        background: '#090d16',
                        padding: '8px',
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                    }}
                >
                    {filteredEvents.length === 0 ? (
                        <div
                            data-testid='telemetry-empty-state'
                            style={{
                                color: '#64748b',
                                textAlign: 'center',
                                padding: '20px 0',
                                fontStyle: 'italic',
                            }}
                        >
                            No telemetry events matching filter. Drag canvas primitives or trigger
                            simulation.
                        </div>
                    ) : (
                        filteredEvents.map((evt) => (
                            <EventRow
                                key={evt.id}
                                event={evt}
                                isExpanded={expandedEventIds.has(evt.id)}
                                onToggleExpand={() => toggleExpand(evt.id)}
                            />
                        ))
                    )}
                    <div ref={feedEndRef} />
                </div>
            </div>
        );
    }
);

interface EventRowProps {
    event: TelemetryEvent;
    isExpanded: boolean;
    onToggleExpand: () => void;
}

const EventRow: React.FC<EventRowProps> = ({ event, isExpanded, onToggleExpand }) => {
    const badgeStyle = getCategoryBadgeStyle(event.category);
    const badgeLabel = getCategoryBadgeLabel(event.category);

    return (
        <div
            data-testid={'telemetry-event-' + event.id}
            data-category={event.category}
            style={{
                borderBottom: '1px solid #1e293b',
                padding: '6px 4px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        flexWrap: 'wrap',
                    }}
                >
                    {/* REQ-1 Colored Badge */}
                    <span
                        data-testid={'badge-' + event.category}
                        style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontWeight: 700,
                            fontSize: '0.7rem',
                            ...badgeStyle,
                        }}
                    >
                        {badgeLabel}
                    </span>

                    {/* Channel */}
                    <span data-testid='event-channel' style={{ color: '#94a3b8', fontWeight: 600 }}>
                        {event.channel}
                    </span>

                    {/* Specific category details */}
                    {event.category === 'ephemeral' && event.latencyUs !== undefined && (
                        <span
                            data-testid='event-latency'
                            style={{
                                color: '#4ade80',
                                background: '#052e16',
                                padding: '1px 5px',
                                borderRadius: '3px',
                                fontSize: '0.7rem',
                            }}
                        >
                            {event.latencyUs} us latency
                        </span>
                    )}

                    {event.category === 'sqlite' && (
                        <>
                            {event.sizeBytes !== undefined && (
                                <span
                                    data-testid='event-size'
                                    style={{
                                        color: '#60a5fa',
                                        background: '#172554',
                                        padding: '1px 5px',
                                        borderRadius: '3px',
                                        fontSize: '0.7rem',
                                    }}
                                >
                                    {event.sizeBytes} B
                                </span>
                            )}
                            {event.updatedFields && event.updatedFields.length > 0 && (
                                <span
                                    data-testid='event-fields'
                                    style={{ color: '#93c5fd', fontSize: '0.7rem' }}
                                >
                                    fields: [{event.updatedFields.join(', ')}]
                                </span>
                            )}
                            {event.rev !== undefined && (
                                <span
                                    data-testid='event-rev'
                                    style={{ color: '#bfdbfe', fontSize: '0.7rem' }}
                                >
                                    rev: {event.rev}
                                </span>
                            )}
                        </>
                    )}

                    {event.category === 'cdc' && (
                        <>
                            {event.origin && (
                                <span
                                    data-testid='event-origin'
                                    style={{
                                        color: '#fb923c',
                                        background: '#431407',
                                        padding: '1px 5px',
                                        borderRadius: '3px',
                                        fontSize: '0.7rem',
                                    }}
                                >
                                    origin: {event.origin}
                                </span>
                            )}
                            <span
                                data-testid='event-timestamp'
                                style={{ color: '#fdba74', fontSize: '0.7rem' }}
                            >
                                {new Date(event.timestamp).toLocaleTimeString()}
                            </span>
                        </>
                    )}
                </div>

                <button
                    data-testid={'event-details-toggle-' + event.id}
                    onClick={onToggleExpand}
                    style={{
                        background: 'transparent',
                        border: '1px solid #334155',
                        color: '#94a3b8',
                        borderRadius: '3px',
                        fontSize: '0.65rem',
                        padding: '1px 6px',
                        cursor: 'pointer',
                    }}
                >
                    {isExpanded ? 'collapse' : 'details'}
                </button>
            </div>

            {/* Payload summary */}
            <div style={{ color: '#cbd5e1', fontSize: '0.72rem', paddingLeft: '2px' }}>
                {event.payloadSummary}
            </div>

            {/* Expandable raw payload */}
            {isExpanded && event.rawPayload !== undefined && (
                <pre
                    data-testid={'event-raw-' + event.id}
                    style={{
                        margin: '4px 0 0',
                        padding: '6px',
                        background: '#020617',
                        borderRadius: '4px',
                        border: '1px solid #1e293b',
                        color: '#38bdf8',
                        fontSize: '0.68rem',
                        overflowX: 'auto',
                        whiteSpace: 'pre-wrap',
                    }}
                >
                    {JSON.stringify(event.rawPayload, null, 2)}
                </pre>
            )}
        </div>
    );
};

function getCategoryBadgeLabel(category: TelemetryCategory): string {
    switch (category) {
        case 'ephemeral':
            return '[RAM 60fps]';
        case 'sqlite':
            return '[SQLITE COMMIT]';
        case 'cdc':
            return '[CDC REPLICA]';
    }
}

function getCategoryBadgeStyle(category: TelemetryCategory): React.CSSProperties {
    switch (category) {
        case 'ephemeral':
            return {
                background: '#14532d',
                color: '#86efac',
                border: '1px solid #22c55e',
            };
        case 'sqlite':
            return {
                background: '#1e3a8a',
                color: '#93c5fd',
                border: '1px solid #3b82f6',
            };
        case 'cdc':
            return {
                background: '#7c2d12',
                color: '#fdba74',
                border: '1px solid #f97316',
            };
    }
}
