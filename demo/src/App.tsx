import React, { useEffect, useState } from 'react';
import { initCadStore, type CadStore } from './cad/store';
import { PropertyInspector } from './components/PropertyInspector';
import { VectorCanvas } from './components/VectorCanvas';
import { TelemetryMonitor } from './components/TelemetryMonitor';
import { SplitSimulator } from './components/SplitSimulator';
import { LiveStoreSpikeHarness } from './components/LiveStoreSpikeHarness';

declare global {
    interface Window {
        __cadStore?: CadStore;
    }
}

export const App: React.FC = () => {
    const spikeParam =
        typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('spike')
            : null;

    if (spikeParam === 'livestore') {
        return <LiveStoreSpikeHarness />;
    }

    const [store, setStore] = useState<CadStore | null>(null);

    const viewportParam =
        typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('viewport')
            : null;

    const splitParam =
        typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('split')
            : null;
    const initialSplitMode = splitParam === 'dual' ? 'dual' : 'single';

    useEffect(() => {
        let activeStore: CadStore | null = null;
        let isDisposed = false;

        const senderId = viewportParam ? 'Viewport ' + viewportParam : 'Host Shell';

        void initCadStore({ senderId }).then((cadStore) => {
            if (isDisposed) {
                void cadStore.close();
                return;
            }
            activeStore = cadStore;
            if (typeof window !== 'undefined') {
                window.__cadStore = cadStore;
            }
            setStore(cadStore);
        });

        return () => {
            isDisposed = true;
            if (typeof window !== 'undefined') {
                delete window.__cadStore;
            }
            if (activeStore) {
                void activeStore.close();
            }
        };
    }, [viewportParam]);

    // Keyboard shortcuts for child viewport mode
    useEffect(() => {
        if (!viewportParam || !store) {
            return () => {};
        }

        const handleKeyDown = (e: KeyboardEvent) => {
            const isCtrl = e.ctrlKey || e.metaKey;
            if (!isCtrl) return;

            const key = e.key.toLowerCase();
            if (key === 'z' && !e.shiftKey) {
                e.preventDefault();
                void store.undo();
            } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
                e.preventDefault();
                void store.redo();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [viewportParam, store]);

    // Child iframe or native tab view
    if (viewportParam) {
        return (
            <div
                data-testid='iframe-viewport-shell'
                style={{
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    padding: '12px',
                    background: '#0f172a',
                    color: '#f8fafc',
                    minHeight: '100vh',
                    boxSizing: 'border-box',
                }}
            >
                <header
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderBottom: '1px solid #334155',
                        paddingBottom: '8px',
                        marginBottom: '12px',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                            data-testid='viewport-indicator'
                            style={{
                                background: viewportParam === 'A' ? '#0369a1' : '#047857',
                                color: '#fff',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '0.8rem',
                                fontWeight: 700,
                            }}
                        >
                            [Viewport {viewportParam}]
                        </span>
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                            Zero-Server LiveSync Peer
                        </span>
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                            data-testid='child-btn-undo'
                            onClick={() => {
                                void store?.undo();
                            }}
                            style={{
                                background: '#334155',
                                color: '#f8fafc',
                                border: 'none',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                            }}
                        >
                            Undo
                        </button>
                        <button
                            data-testid='child-btn-redo'
                            onClick={() => {
                                void store?.redo();
                            }}
                            style={{
                                background: '#334155',
                                color: '#f8fafc',
                                border: 'none',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                            }}
                        >
                            Redo
                        </button>
                    </div>
                </header>

                {store ? (
                    <main
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                        }}
                    >
                        <div
                            style={{
                                background: '#1e293b',
                                borderRadius: '6px',
                                padding: '10px',
                                display: 'flex',
                                justifyContent: 'center',
                            }}
                        >
                            <VectorCanvas store={store} width={500} height={280} />
                        </div>
                        <div
                            style={{
                                background: '#1e293b',
                                borderRadius: '6px',
                                padding: '10px',
                            }}
                        >
                            <PropertyInspector cadStore={store} />
                        </div>
                    </main>
                ) : (
                    <div
                        style={{
                            border: '2px dashed #475569',
                            height: '240px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#94a3b8',
                        }}
                    >
                        Connecting to local OPFS &amp; LiveStruct Mesh...
                    </div>
                )}
            </div>
        );
    }

    // Host shell view
    return (
        <div
            data-testid='host-shell'
            style={{
                fontFamily: 'system-ui, -apple-system, sans-serif',
                padding: '16px',
                background: '#0f172a',
                color: '#f8fafc',
                minHeight: '100vh',
            }}
        >
            <header
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid #334155',
                    paddingBottom: '12px',
                    marginBottom: '16px',
                }}
            >
                <div>
                    <h1 style={{ margin: 0, fontSize: '1.25rem' }}>
                        LiveStruct &amp; MsgMesh CAD Showcase
                    </h1>
                    <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '0.875rem' }}>
                        Local-First SQLite OPFS Document with Real-time Message Mesh &amp; Cross-Tab
                        Sync
                    </p>
                </div>
            </header>

            {store ? (
                <SplitSimulator
                    cadStore={store}
                    initialMode={initialSplitMode}
                />
            ) : (
                <div
                    style={{
                        border: '2px dashed #475569',
                        height: '380px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#94a3b8',
                    }}
                >
                    Initializing OPFS SQLite Engine...
                </div>
            )}

            {/* Global Telemetry & Protocol Monitor */}
            <footer style={{ marginTop: '16px' }}>
                <TelemetryMonitor cadStore={store} />
            </footer>
        </div>
    );
};
