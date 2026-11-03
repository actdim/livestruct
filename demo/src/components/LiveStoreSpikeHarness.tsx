import React, { useEffect, useState, useRef } from 'react';
import { makePersistedAdapter } from '@livestore/adapter-web';
import { createStorePromise } from '@livestore/livestore';
import { schema, tables, events } from '../livestore/schema';
import LiveWorker from '../livestore/worker?worker';
import LiveSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker';

interface SpikeReport {
    role: string;
    sessionId: string;
    storageMode: string;
    longTasksCount: number;
    crossContextLatencies: number[];
    p50Latency?: number;
    p95Latency?: number;
    status: string;
}

export const LiveStoreSpikeHarness: React.FC = () => {
    const searchParams = new URLSearchParams(window.location.search);
    const role = searchParams.get('role') || 'host';
    const isAuto = searchParams.get('auto') === '1';
    const isHost = role === 'host';

    const [report, setReport] = useState<SpikeReport>({
        role,
        sessionId: '',
        storageMode: 'detecting...',
        longTasksCount: 0,
        crossContextLatencies: [],
        status: 'initializing',
    });

    const [iframe1Status, setIframe1Status] = useState<string>('waiting');
    const [iframe2Status, setIframe2Status] = useState<string>('waiting');
    const storeRef = useRef<any>(null);

    useEffect(() => {
        let isDisposed = false;
        let longTaskCount = 0;

        // Long task observer
        let observer: PerformanceObserver | null = null;
        if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
            observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    longTaskCount++;
                    console.warn(`[LiveStore Spike ${role}] Long task detected: ${entry.duration.toFixed(1)}ms`);
                    setReport((prev) => ({ ...prev, longTasksCount: longTaskCount }));
                }
            });
            observer.observe({ entryTypes: ['longtask'] });
        }

        const uniqueSessionId = `session-${role}-${Math.random().toString(36).slice(2, 9)}`;

        async function initStore() {
            try {
                const adapter = makePersistedAdapter({
                    storage: { type: 'opfs' },
                    worker: LiveWorker,
                    sharedWorker: LiveSharedWorker,
                    sessionId: uniqueSessionId,
                });

                const store = await createStorePromise({
                    schema,
                    storeId: 'spike-livestore-cad',
                    adapter,
                    confirmUnsavedChanges: false,
                    disableDevtools: true,
                });

                if (isDisposed) {
                    void store.shutdown();
                    return;
                }

                storeRef.current = store;

                setReport((prev) => ({
                    ...prev,
                    sessionId: uniqueSessionId,
                    storageMode: store.storageMode,
                    status: 'connected',
                }));

                // Listen for cross-context updates
                store.subscribe(tables.docs, (rows) => {
                    const row = rows.find((r) => r.id === 'spike-benchmark-doc');
                    if (row) {
                        try {
                            const data = JSON.parse(row.body);
                            if (data.timeOrigin && data.perfNow && row.origin !== uniqueSessionId) {
                                const nowAbsolute = performance.timeOrigin + performance.now();
                                const sentAbsolute = data.timeOrigin + data.perfNow;
                                const latency = Math.max(0, nowAbsolute - sentAbsolute);
                                if (isHost) {
                                    setReport((prev) => {
                                        const lats = [...prev.crossContextLatencies, latency];
                                        lats.sort((a, b) => a - b);
                                        const p50 = lats[Math.floor(lats.length * 0.5)];
                                        const p95 = lats[Math.floor(lats.length * 0.95)];
                                        return {
                                            ...prev,
                                            crossContextLatencies: lats,
                                            p50Latency: p50,
                                            p95Latency: p95,
                                        };
                                    });
                                } else {
                                    // Report latency back to host window
                                    window.parent.postMessage(
                                        { type: 'spike-latency-report', from: role, latency },
                                        '*'
                                    );
                                }
                            }
                        } catch {
                            // ignore parse error
                        }
                    }
                });

                if (!isHost) {
                    window.parent.postMessage({ type: 'spike-iframe-ready', from: role }, '*');
                }
            } catch (err: any) {
                console.error(`[LiveStore Spike ${role}] Failed to init store:`, err);
                setReport((prev) => ({ ...prev, status: 'error: ' + err.message }));
            }
        }

        void initStore();

        // Listen for iframe ready messages on host
        const handleMessage = (e: MessageEvent) => {
            if (e.data?.type === 'spike-iframe-ready') {
                if (e.data.from === 'iframe1') setIframe1Status('ready');
                if (e.data.from === 'iframe2') setIframe2Status('ready');
            } else if (e.data?.type === 'spike-latency-report') {
                setReport((prev) => {
                    const lats = [...prev.crossContextLatencies, e.data.latency];
                    lats.sort((a, b) => a - b);
                    const p50 = lats[Math.floor(lats.length * 0.5)];
                    const p95 = lats[Math.floor(lats.length * 0.95)];
                    return {
                        ...prev,
                        crossContextLatencies: lats,
                        p50Latency: p50,
                        p95Latency: p95,
                    };
                });
            }
        };

        window.addEventListener('message', handleMessage);

        return () => {
            isDisposed = true;
            if (observer) observer.disconnect();
            window.removeEventListener('message', handleMessage);
            if (storeRef.current) {
                void storeRef.current.shutdown();
            }
        };
    }, [role, isHost]);

    const hasAutoRun = useRef(false);
    useEffect(() => {
        if (!isAuto || !isHost || hasAutoRun.current) {
            return () => {};
        }
        if (report.status === 'connected') {
            const timer = setTimeout(() => {
                hasAutoRun.current = true;
                void runBenchmark();
            }, 1000);
            return () => clearTimeout(timer);
        }
        return () => {};
    }, [isAuto, isHost, report.status]);

    useEffect(() => {
        if (report.crossContextLatencies.length >= 100) {
            console.log('=== SPIKE BENCHMARK COMPLETE ===', JSON.stringify({
                p50: report.p50Latency,
                p95: report.p95Latency,
                count: report.crossContextLatencies.length,
            }));
            (window as any).__spikeResults = {
                p50: report.p50Latency,
                p95: report.p95Latency,
                count: report.crossContextLatencies.length,
            };
        }
    }, [report.crossContextLatencies.length, report.p50Latency, report.p95Latency]);

    // Host triggers 100 cross-context commits
    const runBenchmark = async () => {
        if (!storeRef.current) return;
        const store = storeRef.current;
        const total = 100;

        // Initialize doc
        store.commit(
            events.docCreated({
                id: 'spike-benchmark-doc',
                body: JSON.stringify({
                    count: 0,
                    timeOrigin: performance.timeOrigin,
                    perfNow: performance.now(),
                }),
                mutationId: 'init-0',
                origin: report.sessionId,
            })
        );

        for (let i = 1; i <= total; i++) {
            await new Promise((r) => setTimeout(r, 16)); // 60fps cadence
            store.commit(
                events.docPatched({
                    id: 'spike-benchmark-doc',
                    patch: JSON.stringify({
                        count: i,
                        timeOrigin: performance.timeOrigin,
                        perfNow: performance.now(),
                    }),
                    mutationId: `mut-${i}`,
                    origin: report.sessionId,
                })
            );
        }
    };

    if (!isHost) {
        return (
            <div style={{ padding: 12, fontFamily: 'monospace', fontSize: 12, background: '#1e293b', color: '#f8fafc', border: '1px solid #475569' }}>
                <div><strong>Iframe Context: {role}</strong></div>
                <div>SessionId: {report.sessionId}</div>
                <div>Storage: {report.storageMode}</div>
                <div>Status: {report.status}</div>
                <div>Long Tasks: {report.longTasksCount}</div>
            </div>
        );
    }

    return (
        <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 900, margin: '0 auto', background: '#0f172a', color: '#f8fafc', minHeight: '100vh' }}>
            <h1 style={{ fontSize: 20, marginBottom: 8, color: '#38bdf8' }}>LiveStore Integration Spike Harness (Q4, Q5, Q6, Q8)</h1>
            <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
                Host + 2 same-origin iframes with dedicated unique sessionIds sharing OPFS Leader Worker & SharedWorker.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
                <div style={{ padding: 12, background: '#1e293b', borderRadius: 6, border: '1px solid #334155' }}>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>Host Session</div>
                    <div style={{ fontWeight: 'bold', fontSize: 14 }}>{report.status}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>Mode: {report.storageMode}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>Long Tasks: {report.longTasksCount}</div>
                </div>
                <div style={{ padding: 12, background: '#1e293b', borderRadius: 6, border: '1px solid #334155' }}>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>Iframe 1</div>
                    <div style={{ fontWeight: 'bold', fontSize: 14 }}>{iframe1Status}</div>
                </div>
                <div style={{ padding: 12, background: '#1e293b', borderRadius: 6, border: '1px solid #334155' }}>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>Iframe 2</div>
                    <div style={{ fontWeight: 'bold', fontSize: 14 }}>{iframe2Status}</div>
                </div>
            </div>

            <div style={{ marginBottom: 16 }}>
                <button
                    onClick={runBenchmark}
                    disabled={report.status !== 'connected'}
                    style={{
                        padding: '8px 16px',
                        background: '#2563eb',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        cursor: report.status === 'connected' ? 'pointer' : 'not-allowed',
                        fontWeight: 'bold',
                    }}
                >
                    Run 100-Commit Benchmark (Q5 Multi-Iframe Latency)
                </button>
            </div>

            {report.crossContextLatencies.length > 0 && (
                <div style={{ padding: 16, background: '#1e293b', borderRadius: 6, marginBottom: 16, border: '1px solid #334155' }}>
                    <h3 style={{ fontSize: 14, color: '#38bdf8', marginBottom: 8 }}>Cross-Context Latency Results (n={report.crossContextLatencies.length})</h3>
                    <div>Median (p50): <strong>{report.p50Latency?.toFixed(2)} ms</strong></div>
                    <div>p95: <strong>{report.p95Latency?.toFixed(2)} ms</strong></div>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <iframe
                    src="?spike=livestore&role=iframe1"
                    title="Iframe 1"
                    style={{ width: '100%', height: 160, border: '1px solid #475569', borderRadius: 6 }}
                />
                <iframe
                    src="?spike=livestore&role=iframe2"
                    title="Iframe 2"
                    style={{ width: '100%', height: 160, border: '1px solid #475569', borderRadius: 6 }}
                />
            </div>
        </div>
    );
};
