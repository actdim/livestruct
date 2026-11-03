import React, { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import type { CadStore } from '../cad/store';
import type { CadShape } from '../cad/types';

export interface PropertyInspectorProps {
    cadStore: CadStore;
    className?: string;
    style?: React.CSSProperties;
}

export interface UseDebouncedNameBufferOptions {
    value: string;
    shapeId?: string | null;
    delayMs?: number;
    onCommit: (shapeId: string, name: string) => void;
}

export function useDebouncedNameBuffer({
    value,
    shapeId,
    delayMs = 200,
    onCommit,
}: UseDebouncedNameBufferOptions) {
    const [localValue, setLocalValue] = useState<string>(value);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastCommittedRef = useRef<string>(value);
    const activeShapeIdRef = useRef<string | null>(shapeId ?? null);
    const onCommitRef = useRef(onCommit);
    onCommitRef.current = onCommit;

    useEffect(() => {
        if (shapeId !== activeShapeIdRef.current) {
            if (debounceTimerRef.current && activeShapeIdRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
                onCommitRef.current(activeShapeIdRef.current, localValue);
            }
            activeShapeIdRef.current = shapeId ?? null;
            setLocalValue(value);
            lastCommittedRef.current = value;
            return;
        }

        if (value !== lastCommittedRef.current) {
            lastCommittedRef.current = value;
            if (!debounceTimerRef.current) {
                setLocalValue(value);
            }
        }
    }, [shapeId, value, localValue]);

    const flush = useCallback(() => {
        if (debounceTimerRef.current && activeShapeIdRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
            lastCommittedRef.current = localValue;
            onCommitRef.current(activeShapeIdRef.current, localValue);
        }
    }, [localValue]);

    const change = useCallback(
        (newValue: string) => {
            setLocalValue(newValue);
            if (!activeShapeIdRef.current) return;
            const currentId = activeShapeIdRef.current;

            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }

            debounceTimerRef.current = setTimeout(() => {
                debounceTimerRef.current = null;
                lastCommittedRef.current = newValue;
                onCommitRef.current(currentId, newValue);
            }, delayMs);
        },
        [delayMs]
    );

    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, []);

    return {
        value: localValue,
        onChange: change,
        flush,
        isDebouncing: Boolean(debounceTimerRef.current),
    };
}

function normalizeHexColor(color: string | undefined, fallback: string): string {
    if (!color) return fallback;
    if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
    if (/^#[0-9a-fA-F]{3}$/.test(color)) {
        return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
    }
    return fallback;
}

export const PropertyInspector: React.FC<PropertyInspectorProps> = observer(
    ({ cadStore, className, style }) => {
        const docData = cadStore.doc.data;
        const shapes = docData.shapes ?? {};
        const selectedShapeId = docData.selectedShapeId;
        const selectedShape: CadShape | null =
            selectedShapeId && shapes[selectedShapeId] ? shapes[selectedShapeId] : null;

        const patchShape = useCallback(
            (shapeId: string, updates: Partial<CadShape>) => {
                if (typeof cadStore.updateShapeProperties === 'function') {
                    void cadStore.updateShapeProperties(shapeId, updates);
                } else {
                    void cadStore.doc.patch({
                        shapes: {
                            [shapeId]: updates,
                        },
                    });
                }
            },
            [cadStore]
        );

        const handleSelectShape = useCallback(
            (shapeId: string | null) => {
                if (typeof cadStore.selectShape === 'function') {
                    void cadStore.selectShape(shapeId);
                } else {
                    void cadStore.doc.patch({
                        selectedShapeId: shapeId,
                    });
                }
            },
            [cadStore]
        );

        const nameBuffer = useDebouncedNameBuffer({
            value: selectedShape?.name ?? '',
            shapeId: selectedShape?.id ?? null,
            delayMs: 200,
            onCommit: (shapeId, name) => {
                patchShape(shapeId, { name });
            },
        });

        const handleNumberFieldChange = (field: keyof CadShape, rawValue: string) => {
            if (!selectedShape) return;
            const parsed = parseFloat(rawValue);
            if (!isNaN(parsed)) {
                patchShape(selectedShape.id, { [field]: parsed });
            }
        };

        const shapeList = Object.values(shapes);

        return (
            <div
                className={className}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    color: '#f8fafc',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    ...style,
                }}
            >
                {/* Shape Selector & Deselect Bar */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select
                        data-testid='shape-selector'
                        aria-label='Select Shape'
                        value={selectedShapeId ?? ''}
                        onChange={(e) => handleSelectShape(e.target.value || null)}
                        style={{
                            flex: 1,
                            padding: '6px 8px',
                            background: '#0f172a',
                            border: '1px solid #475569',
                            borderRadius: '4px',
                            color: '#f8fafc',
                            fontSize: '0.85rem',
                            outline: 'none',
                        }}
                    >
                        <option value=''>-- No shape selected --</option>
                        {shapeList.map((shape) => (
                            <option key={shape.id} value={shape.id}>
                                {shape.name ? `${shape.name} (${shape.id})` : shape.id}
                            </option>
                        ))}
                    </select>
                    <button
                        type='button'
                        data-testid='btn-deselect'
                        aria-label='Deselect Shape'
                        onClick={() => handleSelectShape(null)}
                        disabled={!selectedShapeId}
                        style={{
                            background: selectedShapeId ? '#334155' : '#1e293b',
                            color: selectedShapeId ? '#f8fafc' : '#64748b',
                            border: '1px solid #475569',
                            borderRadius: '4px',
                            padding: '6px 12px',
                            fontSize: '0.85rem',
                            cursor: selectedShapeId ? 'pointer' : 'not-allowed',
                        }}
                    >
                        Deselect
                    </button>
                </div>

                {/* Empty State */}
                {!selectedShape ? (
                    <div
                        data-testid='empty-inspector-state'
                        style={{
                            color: '#64748b',
                            fontSize: '0.85rem',
                            padding: '16px 0',
                            textAlign: 'center',
                            border: '1px dashed #334155',
                            borderRadius: '4px',
                        }}
                    >
                        No shape selected. Select a shape from the dropdown or click a primitive on
                        the canvas.
                    </div>
                ) : (
                    /* Active Shape Form */
                    <div
                        data-testid='shape-properties-form'
                        style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
                    >
                        {/* ID and Type */}
                        <div
                            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}
                        >
                            <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                Shape ID
                                <input
                                    type='text'
                                    readOnly
                                    value={selectedShape.id}
                                    style={{
                                        width: '100%',
                                        marginTop: '4px',
                                        padding: '6px',
                                        background: '#090d16',
                                        border: '1px solid #334155',
                                        borderRadius: '4px',
                                        color: '#94a3b8',
                                        boxSizing: 'border-box',
                                        fontSize: '0.8rem',
                                    }}
                                />
                            </label>
                            <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                Shape Type
                                <input
                                    type='text'
                                    readOnly
                                    value={selectedShape.type}
                                    style={{
                                        width: '100%',
                                        marginTop: '4px',
                                        padding: '6px',
                                        background: '#090d16',
                                        border: '1px solid #334155',
                                        borderRadius: '4px',
                                        color: '#94a3b8',
                                        boxSizing: 'border-box',
                                        fontSize: '0.8rem',
                                    }}
                                />
                            </label>
                        </div>

                        {/* Name (buffered with 200ms debounce commit) */}
                        <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                            Shape Name
                            <input
                                data-testid='input-name'
                                aria-label='Shape Name'
                                type='text'
                                value={nameBuffer.value}
                                onChange={(e) => nameBuffer.onChange(e.target.value)}
                                onBlur={nameBuffer.flush}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        nameBuffer.flush();
                                    }
                                }}
                                placeholder='Enter shape name...'
                                style={{
                                    width: '100%',
                                    marginTop: '4px',
                                    padding: '6px',
                                    background: '#0f172a',
                                    border: '1px solid #475569',
                                    borderRadius: '4px',
                                    color: '#f8fafc',
                                    boxSizing: 'border-box',
                                    fontSize: '0.85rem',
                                }}
                            />
                        </label>

                        {/* Layer dropdown */}
                        <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                            Layer
                            <select
                                data-testid='select-layer'
                                aria-label='Layer'
                                value={selectedShape.layer ?? 'geometry'}
                                onChange={(e) =>
                                    patchShape(selectedShape.id, { layer: e.target.value })
                                }
                                style={{
                                    width: '100%',
                                    marginTop: '4px',
                                    padding: '6px',
                                    background: '#0f172a',
                                    border: '1px solid #475569',
                                    borderRadius: '4px',
                                    color: '#f8fafc',
                                    boxSizing: 'border-box',
                                    fontSize: '0.85rem',
                                }}
                            >
                                <option value='geometry'>geometry</option>
                                <option value='guides'>guides</option>
                                <option value='dimensions'>dimensions</option>
                            </select>
                        </label>

                        {/* Fill Color Picker */}
                        <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                            Fill Color
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    marginTop: '4px',
                                }}
                            >
                                <input
                                    data-testid='input-fill'
                                    aria-label='Fill Color'
                                    type='color'
                                    value={normalizeHexColor(selectedShape.fill, '#3b82f6')}
                                    onChange={(e) =>
                                        patchShape(selectedShape.id, { fill: e.target.value })
                                    }
                                    style={{
                                        width: '48px',
                                        height: '32px',
                                        background: '#0f172a',
                                        border: '1px solid #475569',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        padding: 0,
                                    }}
                                />
                                <span
                                    style={{
                                        fontSize: '0.8rem',
                                        fontFamily: 'monospace',
                                        color: '#cbd5e1',
                                    }}
                                >
                                    {selectedShape.fill ?? '#3b82f6'}
                                </span>
                            </div>
                        </label>

                        {/* Stroke Color Picker */}
                        <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                            Stroke Color
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    marginTop: '4px',
                                }}
                            >
                                <input
                                    data-testid='input-stroke'
                                    aria-label='Stroke Color'
                                    type='color'
                                    value={normalizeHexColor(selectedShape.stroke, '#60a5fa')}
                                    onChange={(e) =>
                                        patchShape(selectedShape.id, { stroke: e.target.value })
                                    }
                                    style={{
                                        width: '48px',
                                        height: '32px',
                                        background: '#0f172a',
                                        border: '1px solid #475569',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        padding: 0,
                                    }}
                                />
                                <span
                                    style={{
                                        fontSize: '0.8rem',
                                        fontFamily: 'monospace',
                                        color: '#cbd5e1',
                                    }}
                                >
                                    {selectedShape.stroke ?? '#60a5fa'}
                                </span>
                            </div>
                        </label>

                        {/* Stroke Width Slider */}
                        <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Stroke Width</span>
                                <span style={{ color: '#cbd5e1' }}>
                                    {selectedShape.strokeWidth ?? 1}px
                                </span>
                            </div>
                            <input
                                data-testid='input-stroke-width'
                                aria-label='Stroke Width'
                                type='range'
                                min='1'
                                max='10'
                                step='1'
                                value={selectedShape.strokeWidth ?? 1}
                                onChange={(e) =>
                                    patchShape(selectedShape.id, {
                                        strokeWidth: Number(e.target.value),
                                    })
                                }
                                style={{
                                    width: '100%',
                                    marginTop: '4px',
                                    accentColor: '#3b82f6',
                                    cursor: 'pointer',
                                }}
                            />
                        </label>

                        {/* Coordinates (X, Y) */}
                        <div
                            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}
                        >
                            <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                X Coordinate
                                <input
                                    data-testid='input-x'
                                    aria-label='Coordinate X'
                                    type='number'
                                    value={Math.round(selectedShape.x)}
                                    onChange={(e) => handleNumberFieldChange('x', e.target.value)}
                                    style={{
                                        width: '100%',
                                        marginTop: '4px',
                                        padding: '6px',
                                        background: '#0f172a',
                                        border: '1px solid #475569',
                                        borderRadius: '4px',
                                        color: '#f8fafc',
                                        boxSizing: 'border-box',
                                        fontSize: '0.85rem',
                                    }}
                                />
                            </label>
                            <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                Y Coordinate
                                <input
                                    data-testid='input-y'
                                    aria-label='Coordinate Y'
                                    type='number'
                                    value={Math.round(selectedShape.y)}
                                    onChange={(e) => handleNumberFieldChange('y', e.target.value)}
                                    style={{
                                        width: '100%',
                                        marginTop: '4px',
                                        padding: '6px',
                                        background: '#0f172a',
                                        border: '1px solid #475569',
                                        borderRadius: '4px',
                                        color: '#f8fafc',
                                        boxSizing: 'border-box',
                                        fontSize: '0.85rem',
                                    }}
                                />
                            </label>
                        </div>

                        {/* Dimensions for Rect */}
                        {selectedShape.type === 'rect' && (
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gap: '8px',
                                }}
                            >
                                <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                    Width
                                    <input
                                        data-testid='input-width'
                                        aria-label='Width'
                                        type='number'
                                        value={selectedShape.width ?? 0}
                                        onChange={(e) =>
                                            handleNumberFieldChange('width', e.target.value)
                                        }
                                        style={{
                                            width: '100%',
                                            marginTop: '4px',
                                            padding: '6px',
                                            background: '#0f172a',
                                            border: '1px solid #475569',
                                            borderRadius: '4px',
                                            color: '#f8fafc',
                                            boxSizing: 'border-box',
                                            fontSize: '0.85rem',
                                        }}
                                    />
                                </label>
                                <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                    Height
                                    <input
                                        data-testid='input-height'
                                        aria-label='Height'
                                        type='number'
                                        value={selectedShape.height ?? 0}
                                        onChange={(e) =>
                                            handleNumberFieldChange('height', e.target.value)
                                        }
                                        style={{
                                            width: '100%',
                                            marginTop: '4px',
                                            padding: '6px',
                                            background: '#0f172a',
                                            border: '1px solid #475569',
                                            borderRadius: '4px',
                                            color: '#f8fafc',
                                            boxSizing: 'border-box',
                                            fontSize: '0.85rem',
                                        }}
                                    />
                                </label>
                            </div>
                        )}

                        {/* Radius for Circle */}
                        {selectedShape.type === 'circle' && (
                            <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                Radius
                                <input
                                    data-testid='input-radius'
                                    aria-label='Radius'
                                    type='number'
                                    value={selectedShape.radius ?? 0}
                                    onChange={(e) =>
                                        handleNumberFieldChange('radius', e.target.value)
                                    }
                                    style={{
                                        width: '100%',
                                        marginTop: '4px',
                                        padding: '6px',
                                        background: '#0f172a',
                                        border: '1px solid #475569',
                                        borderRadius: '4px',
                                        color: '#f8fafc',
                                        boxSizing: 'border-box',
                                        fontSize: '0.85rem',
                                    }}
                                />
                            </label>
                        )}

                        {/* End Coordinates for Line */}
                        {selectedShape.type === 'line' && (
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gap: '8px',
                                }}
                            >
                                <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                    X2 Coordinate
                                    <input
                                        data-testid='input-x2'
                                        aria-label='Coordinate X2'
                                        type='number'
                                        value={selectedShape.x2 ?? 0}
                                        onChange={(e) =>
                                            handleNumberFieldChange('x2', e.target.value)
                                        }
                                        style={{
                                            width: '100%',
                                            marginTop: '4px',
                                            padding: '6px',
                                            background: '#0f172a',
                                            border: '1px solid #475569',
                                            borderRadius: '4px',
                                            color: '#f8fafc',
                                            boxSizing: 'border-box',
                                            fontSize: '0.85rem',
                                        }}
                                    />
                                </label>
                                <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                    Y2 Coordinate
                                    <input
                                        data-testid='input-y2'
                                        aria-label='Coordinate Y2'
                                        type='number'
                                        value={selectedShape.y2 ?? 0}
                                        onChange={(e) =>
                                            handleNumberFieldChange('y2', e.target.value)
                                        }
                                        style={{
                                            width: '100%',
                                            marginTop: '4px',
                                            padding: '6px',
                                            background: '#0f172a',
                                            border: '1px solid #475569',
                                            borderRadius: '4px',
                                            color: '#f8fafc',
                                            boxSizing: 'border-box',
                                            fontSize: '0.85rem',
                                        }}
                                    />
                                </label>
                            </div>
                        )}

                        {/* Rotation Slider */}
                        <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Rotation</span>
                                <span style={{ color: '#cbd5e1' }}>
                                    {selectedShape.rotation ?? 0} deg
                                </span>
                            </div>
                            <input
                                data-testid='input-rotation'
                                aria-label='Rotation'
                                type='range'
                                min='0'
                                max='360'
                                step='1'
                                value={selectedShape.rotation ?? 0}
                                onChange={(e) =>
                                    handleNumberFieldChange('rotation', e.target.value)
                                }
                                style={{
                                    width: '100%',
                                    marginTop: '4px',
                                    accentColor: '#3b82f6',
                                    cursor: 'pointer',
                                }}
                            />
                        </label>
                    </div>
                )}
            </div>
        );
    }
);
