import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CadStore } from '../cad/store';
import { downloadCadProject, importCadDatabase } from '../cad/exportImport';
import { VectorCanvas } from './VectorCanvas';
import { PropertyInspector } from './PropertyInspector';

export type ViewportMode = 'single' | 'dual' | 'native-tab';

export interface SplitSimulatorProps {
    cadStore: CadStore;
    initialMode?: ViewportMode;
    onModeChange?: (mode: ViewportMode) => void;
    className?: string;
    style?: React.CSSProperties;
}

export const SplitSimulator: React.FC<SplitSimulatorProps> = ({
    cadStore,
    initialMode = 'single',
    onModeChange,
    className,
    style,
}) => {
    const [mode, setMode] = useState<ViewportMode>(initialMode);
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const handleModeSwitch = useCallback(
        (newMode: ViewportMode) => {
            if (newMode === 'native-tab') {
                if (typeof window !== 'undefined') {
                    const targetUrl = `${window.location.origin}${window.location.pathname}?viewport=native`;
                    window.open(targetUrl, '_blank');
                }
                onModeChange?.('native-tab');
                return;
            }
            setMode(newMode);
            onModeChange?.(newMode);
        },
        [onModeChange]
    );

    // REQ-4: Hotkey handling for Undo (Ctrl+Z) and Redo (Ctrl+Y / Ctrl+Shift+Z)
    const handleUndo = useCallback(async () => {
        const success = await cadStore.undo();
        if (success) {
            setStatusMessage('Undo executed');
            setTimeout(() => setStatusMessage(null), 1500);
        }
    }, [cadStore]);

    const handleRedo = useCallback(async () => {
        const success = await cadStore.redo();
        if (success) {
            setStatusMessage('Redo executed');
            setTimeout(() => setStatusMessage(null), 1500);
        }
    }, [cadStore]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isCtrl = e.ctrlKey || e.metaKey;
            if (!isCtrl) return;

            const key = e.key.toLowerCase();
            if (key === 'z' && !e.shiftKey) {
                e.preventDefault();
                void handleUndo();
            } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
                e.preventDefault();
                void handleRedo();
            }
        };

        if (typeof window === 'undefined') {
            return () => {};
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [handleUndo, handleRedo]);

    // REQ-5: Export project database (.cad)
    const handleExport = useCallback(async () => {
        try {
            await downloadCadProject(cadStore);
            setStatusMessage('Exported project (.cad)');
            setTimeout(() => setStatusMessage(null), 2000);
        } catch (err) {
            setStatusMessage('Export failed: ' + String(err));
        }
    }, [cadStore]);

    // REQ-6: Import binary database (.cad / .db)
    const handleImportBytes = useCallback(
        async (bytes: Uint8Array) => {
            try {
                await importCadDatabase(cadStore, bytes);
                setStatusMessage('Project imported successfully');
                setTimeout(() => setStatusMessage(null), 2500);
            } catch (err) {
                setStatusMessage('Import failed: ' + String(err));
            }
        },
        [cadStore]
    );

    const handleFileInputChange = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            const file = files[0];
            const buffer = await file.arrayBuffer();
            await handleImportBytes(new Uint8Array(buffer));
            e.target.value = '';
        },
        [handleImportBytes]
    );

    const handleDrop = useCallback(
        async (e: React.DragEvent) => {
            e.preventDefault();
            setIsDraggingOver(false);
            const files = e.dataTransfer.files;
            if (!files || files.length === 0) return;
            const file = files[0];
            const buffer = await file.arrayBuffer();
            await handleImportBytes(new Uint8Array(buffer));
        },
        [handleImportBytes]
    );

    return (
        <div
            className={className}
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                position: 'relative',
                ...style,
            }}
            onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOver(true);
            }}
            onDragLeave={(e) => {
                e.preventDefault();
                setIsDraggingOver(false);
            }}
            onDrop={handleDrop}
            data-testid='split-simulator-container'
        >
            {/* Drag & drop overlay indicator */}
            {isDraggingOver && (
                <div
                    data-testid='drag-drop-overlay'
                    style={{
                        position: 'absolute',
                        inset: 0,
                        backgroundColor: 'rgba(37, 99, 235, 0.25)',
                        border: '2px dashed #60a5fa',
                        borderRadius: '8px',
                        zIndex: 100,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                    }}
                >
                    <span
                        style={{
                            background: '#1e293b',
                            color: '#60a5fa',
                            padding: '8px 16px',
                            borderRadius: '4px',
                            fontWeight: 600,
                        }}
                    >
                        Drop .cad or .db SQLite file to mount
                    </span>
                </div>
            )}

            {/* Toolbar */}
            <div
                data-testid='host-shell-toolbar'
                style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#1e293b',
                    padding: '10px 14px',
                    borderRadius: '6px',
                    border: '1px solid #334155',
                    gap: '10px',
                }}
            >
                {/* REQ-3: Viewport mode toggles */}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8', marginRight: '4px' }}>
                        Viewport Mode:
                    </span>
                    <button
                        data-testid='btn-mode-single'
                        onClick={() => handleModeSwitch('single')}
                        style={{
                            background: mode === 'single' ? '#2563eb' : '#334155',
                            color: '#fff',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: mode === 'single' ? 600 : 400,
                        }}
                    >
                        Single Viewport
                    </button>
                    <button
                        data-testid='btn-mode-dual'
                        onClick={() => handleModeSwitch('dual')}
                        style={{
                            background: mode === 'dual' ? '#2563eb' : '#334155',
                            color: '#fff',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: mode === 'dual' ? 600 : 400,
                        }}
                    >
                        Dual iframe Split
                    </button>
                    <button
                        data-testid='btn-mode-native'
                        onClick={() => handleModeSwitch('native-tab')}
                        style={{
                            background: '#334155',
                            color: '#94a3b8',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                        }}
                    >
                        Open Native Tab
                    </button>
                </div>

                {/* Undo / Redo & File Portability */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {statusMessage && (
                        <span
                            data-testid='status-message'
                            style={{
                                fontSize: '0.8rem',
                                color: '#38bdf8',
                                background: '#0f172a',
                                padding: '4px 8px',
                                borderRadius: '4px',
                            }}
                        >
                            {statusMessage}
                        </span>
                    )}

                    {/* REQ-4: Undo / Redo buttons */}
                    <button
                        data-testid='btn-undo'
                        onClick={handleUndo}
                        style={{
                            background: '#334155',
                            color: '#f8fafc',
                            border: 'none',
                            padding: '6px 10px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                        }}
                    >
                        Undo (Ctrl+Z)
                    </button>
                    <button
                        data-testid='btn-redo'
                        onClick={handleRedo}
                        style={{
                            background: '#334155',
                            color: '#f8fafc',
                            border: 'none',
                            padding: '6px 10px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                        }}
                    >
                        Redo (Ctrl+Y)
                    </button>

                    {/* REQ-5: Export Project */}
                    <button
                        data-testid='btn-export-cad'
                        onClick={handleExport}
                        style={{
                            background: '#047857',
                            color: '#fff',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 500,
                        }}
                    >
                        Export Project (.cad)
                    </button>

                    {/* REQ-6: Import Project */}
                    <button
                        data-testid='btn-import-cad'
                        onClick={() => fileInputRef.current?.click()}
                        style={{
                            background: '#475569',
                            color: '#fff',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                        }}
                    >
                        Import Project
                    </button>
                    <input
                        ref={fileInputRef}
                        type='file'
                        accept='.cad,.db,.json'
                        style={{ display: 'none' }}
                        data-testid='input-import-file'
                        onChange={handleFileInputChange}
                    />
                </div>
            </div>

            {/* Viewport Area */}
            {mode === 'single' ? (
                <main
                    data-testid='single-viewport-container'
                    style={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr',
                        gap: '16px',
                    }}
                >
                    <section
                        style={{
                            background: '#1e293b',
                            borderRadius: '6px',
                            padding: '16px',
                            minHeight: '460px',
                        }}
                    >
                        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Interactive CAD Canvas</h2>
                        <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '12px' }}>
                            Dragging shapes streams in-memory at 60fps via MsgMesh. Releasing mouse
                            commits to SQLite OPFS.
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <VectorCanvas store={cadStore} width={680} height={380} />
                        </div>
                    </section>

                    <section
                        style={{ background: '#1e293b', borderRadius: '6px', padding: '16px' }}
                    >
                        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>LiveDocument Properties</h2>
                        <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '12px' }}>
                            Reactive LiveDocument form synchronized with local SQLite.
                        </p>
                        <PropertyInspector cadStore={cadStore} />
                    </section>
                </main>
            ) : (
                /* REQ-1: Dual isolated same-origin iframes */
                <main
                    data-testid='dual-split-container'
                    style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '14px',
                    }}
                >
                    <section
                        data-testid='iframe-pane-a'
                        style={{
                            background: '#1e293b',
                            borderRadius: '6px',
                            border: '1px solid #334155',
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                        }}
                    >
                        <div
                            style={{
                                padding: '8px 12px',
                                background: '#0f172a',
                                borderBottom: '1px solid #334155',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                fontSize: '0.85rem',
                            }}
                        >
                            <span style={{ fontWeight: 600, color: '#38bdf8' }}>
                                [Viewport A] Isolated iframe
                            </span>
                            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                                allow-scripts allow-same-origin
                            </span>
                        </div>
                        <iframe
                            data-testid='iframe-viewport-a'
                            src='?viewport=A'
                            title='CAD Viewport A'
                            sandbox='allow-scripts allow-same-origin allow-forms'
                            style={{
                                width: '100%',
                                height: '560px',
                                border: 'none',
                                background: '#0f172a',
                            }}
                        />
                    </section>

                    <section
                        data-testid='iframe-pane-b'
                        style={{
                            background: '#1e293b',
                            borderRadius: '6px',
                            border: '1px solid #334155',
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                        }}
                    >
                        <div
                            style={{
                                padding: '8px 12px',
                                background: '#0f172a',
                                borderBottom: '1px solid #334155',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                fontSize: '0.85rem',
                            }}
                        >
                            <span style={{ fontWeight: 600, color: '#34d399' }}>
                                [Viewport B] Isolated iframe
                            </span>
                            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                                allow-scripts allow-same-origin
                            </span>
                        </div>
                        <iframe
                            data-testid='iframe-viewport-b'
                            src='?viewport=B'
                            title='CAD Viewport B'
                            sandbox='allow-scripts allow-same-origin allow-forms'
                            style={{
                                width: '100%',
                                height: '560px',
                                border: 'none',
                                background: '#0f172a',
                            }}
                        />
                    </section>
                </main>
            )}
        </div>
    );
};
