/**
 * @actdim/livestruct - Lens and Path Checking Test Suite
 * Validates compile-time type safety, recursion limits, and runtime lens operations.
 */

import { describe, it, expect } from 'vitest';
import {
    getNestedPath,
    hasNestedPath,
    setNestedPath,
    deleteNestedPath,
    type NestedPath,
    type PathValue,
} from '../src/lens/index';

interface Feature {
    id: string;
    color: string;
    coordinates: [number, number];
    visible: boolean;
}

interface Layer {
    name: string;
    features: Feature[];
    opacity: number;
}

interface DocumentSchema {
    id: string;
    title: string;
    layer: Layer;
    metadata?: {
        author: {
            name: string;
            email: string;
        };
        tags: string[];
    };
    createdAt: Date;
    geometry: Float32Array;
    buffer: Uint8Array;
    validator: () => boolean;
}

interface RecursiveNode {
    id: string;
    child?: RecursiveNode;
}

describe('Type-Safe Path Checking & Lens Subsystem', () => {
    const sampleDoc: DocumentSchema = {
        id: 'doc-1',
        title: 'Map Layer 1',
        layer: {
            name: 'Vector Polygons',
            features: [
                { id: 'f-1', color: '#ff0000', coordinates: [10, 20], visible: true },
                { id: 'f-2', color: '#00ff00', coordinates: [30, 40], visible: false },
            ],
            opacity: 0.85,
        },
        metadata: {
            author: {
                name: 'Alice',
                email: 'alice@example.com',
            },
            tags: ['cad', 'gis'],
        },
        createdAt: new Date('2026-01-01T00:00:00Z'),
        geometry: new Float32Array([1.0, 2.0, 3.0]),
        buffer: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
        validator: () => true,
    };

    describe('1. Compile-Time Type Safety & Autocomplete Validations', () => {
        it('resolves exact types at compile-time for shallow and deep paths', () => {
            const title = getNestedPath(sampleDoc, 'title');
            const opacity = getNestedPath(sampleDoc, 'layer.opacity');
            const color = getNestedPath(sampleDoc, 'layer.features.0.color');
            const coords = getNestedPath(sampleDoc, 'layer.features.0.coordinates');
            const authorName = getNestedPath(sampleDoc, 'metadata.author.name');

            // Type verification via static assignment
            const _t1: string | undefined = title;
            const _t2: number | undefined = opacity;
            const _t3: string | undefined = color;
            const _t4: [number, number] | undefined = coords;
            const _t5: string | undefined = authorName;

            expect(_t1).toBe('Map Layer 1');
            expect(_t2).toBe(0.85);
            expect(_t3).toBe('#ff0000');
            expect(_t4).toEqual([10, 20]);
            expect(_t5).toBe('Alice');
        });

        it('disallows typos in property path strings at compile-time', () => {
            // @ts-expect-error - typo 'titl' does not exist on DocumentSchema
            getNestedPath(sampleDoc, 'titl');

            // @ts-expect-error - typo in intermediate key 'layr'
            getNestedPath(sampleDoc, 'layr.opacity');

            // @ts-expect-error - typo in leaf key 'colr' instead of 'color'
            getNestedPath(sampleDoc, 'layer.features.0.colr');

            // @ts-expect-error - non-numeric index for array traversal
            getNestedPath(sampleDoc, 'layer.features.first.color');
        });

        it('treats leaf types (Date, Float32Array, Uint8Array, Function) as terminal nodes', () => {
            // Valid leaf access
            const date = getNestedPath(sampleDoc, 'createdAt');
            const geom = getNestedPath(sampleDoc, 'geometry');
            expect(date).toBeInstanceOf(Date);
            expect(geom).toBeInstanceOf(Float32Array);

            // @ts-expect-error - Date methods must not be traversed
            getNestedPath(sampleDoc, 'createdAt.getTime');

            // @ts-expect-error - Float32Array buffer must not be traversed
            getNestedPath(sampleDoc, 'geometry.buffer');

            // @ts-expect-error - Uint8Array methods must not be traversed
            getNestedPath(sampleDoc, 'buffer.byteLength');

            // @ts-expect-error - Functions must not be traversed
            getNestedPath(sampleDoc, 'validator.call');
        });

        it('guards recursion depth on recursive schemas to avoid compiler freezes', () => {
            const recursiveObj: RecursiveNode = {
                id: 'root',
                child: {
                    id: 'c1',
                    child: {
                        id: 'c2',
                        child: {
                            id: 'c3',
                        },
                    },
                },
            };

            const id1 = getNestedPath(recursiveObj, 'id');
            const id2 = getNestedPath(recursiveObj, 'child.id');
            const id3 = getNestedPath(recursiveObj, 'child.child.id');
            const id4 = getNestedPath(recursiveObj, 'child.child.child.id');

            expect(id1).toBe('root');
            expect(id2).toBe('c1');
            expect(id3).toBe('c2');
            expect(id4).toBe('c3');

            // @ts-expect-error - Path exceeding recursion depth limit produces compile error
            getNestedPath(recursiveObj, 'child.child.child.child.child.id');
        });
    });

    describe('2. Runtime getNestedPath Traversal', () => {
        it('safely resolves single and multi-level properties', () => {
            expect(getNestedPath(sampleDoc, 'id')).toBe('doc-1');
            expect(getNestedPath(sampleDoc, 'layer.name')).toBe('Vector Polygons');
            expect(getNestedPath(sampleDoc, 'metadata.author.email')).toBe('alice@example.com');
        });

        it('resolves array elements and nested fields inside arrays', () => {
            expect(getNestedPath(sampleDoc, 'layer.features.0.id')).toBe('f-1');
            expect(getNestedPath(sampleDoc, 'layer.features.1.color')).toBe('#00ff00');
            expect(getNestedPath(sampleDoc, 'layer.features.0.visible')).toBe(true);
            expect(getNestedPath(sampleDoc, 'layer.features.1.visible')).toBe(false);
            expect(getNestedPath(sampleDoc, 'metadata.tags.0')).toBe('cad');
            expect(getNestedPath(sampleDoc, 'metadata.tags.1')).toBe('gis');
        });

        it('returns undefined safely when encountering missing keys or indices without throwing', () => {
            expect(getNestedPath(sampleDoc, 'layer.features.99.color' as any)).toBeUndefined();
            expect(getNestedPath(sampleDoc, 'metadata.tags.5' as any)).toBeUndefined();
            expect(getNestedPath(sampleDoc, 'nonexistent.key' as any)).toBeUndefined();
        });

        it('returns undefined safely when target or intermediate segments are null or undefined', () => {
            const docWithoutMeta: DocumentSchema = { ...sampleDoc, metadata: undefined };
            expect(getNestedPath(docWithoutMeta, 'metadata.author.name')).toBeUndefined();

            expect(getNestedPath(null as any, 'layer.name')).toBeUndefined();
            expect(getNestedPath(undefined as any, 'layer.name')).toBeUndefined();
            expect(getNestedPath(sampleDoc, '' as any)).toBeUndefined();
        });
    });

    describe('3. Runtime hasNestedPath Verification', () => {
        it('returns true for existing shallow and deep keys', () => {
            expect(hasNestedPath(sampleDoc, 'id')).toBe(true);
            expect(hasNestedPath(sampleDoc, 'layer.name')).toBe(true);
            expect(hasNestedPath(sampleDoc, 'layer.features.0.color')).toBe(true);
            expect(hasNestedPath(sampleDoc, 'metadata.author.email')).toBe(true);
            expect(hasNestedPath(sampleDoc, 'metadata.tags.0')).toBe(true);
        });

        it('returns true for properties set explicitly to undefined or null', () => {
            const objWithNulls = {
                a: {
                    b: undefined,
                    c: null,
                },
            };
            expect(hasNestedPath(objWithNulls, 'a.b')).toBe(true);
            expect(hasNestedPath(objWithNulls, 'a.c')).toBe(true);
        });

        it('returns false for missing properties, out of bound indices, or invalid roots', () => {
            expect(hasNestedPath(sampleDoc, 'layer.features.99')).toBe(false);
            expect(hasNestedPath(sampleDoc, 'layer.features.-1')).toBe(false);
            expect(hasNestedPath(sampleDoc, 'layer.features.0.missingKey')).toBe(false);
            expect(hasNestedPath(sampleDoc, 'unknownProperty')).toBe(false);
            expect(hasNestedPath(null, 'id')).toBe(false);
            expect(hasNestedPath(undefined, 'id')).toBe(false);
            expect(hasNestedPath(123, 'id')).toBe(false);
            expect(hasNestedPath(sampleDoc, '')).toBe(false);
        });
    });

    describe('4. Runtime setNestedPath Immutability & Updates', () => {
        it('immutably updates top-level and nested properties', () => {
            const updated = setNestedPath(sampleDoc, 'title', 'Updated Layer Title');

            expect(updated).not.toBe(sampleDoc);
            expect(updated.title).toBe('Updated Layer Title');
            expect(sampleDoc.title).toBe('Map Layer 1');
            expect(updated.layer).toBe(sampleDoc.layer); // Structural sharing for untouched branches
        });

        it('immutably updates deep nested properties with structural sharing', () => {
            const updated = setNestedPath(sampleDoc, 'layer.opacity', 0.5);

            expect(updated).not.toBe(sampleDoc);
            expect(updated.layer).not.toBe(sampleDoc.layer);
            expect(updated.layer.opacity).toBe(0.5);
            expect(sampleDoc.layer.opacity).toBe(0.85);

            // Untouched branches remain identical references
            expect(updated.metadata).toBe(sampleDoc.metadata);
            expect(updated.layer.features).toBe(sampleDoc.layer.features);
        });

        it('immutably updates array elements at specific indices', () => {
            const updated = setNestedPath(sampleDoc, 'layer.features.0.color', '#0000ff');

            expect(updated.layer.features).not.toBe(sampleDoc.layer.features);
            expect(updated.layer.features[0].color).toBe('#0000ff');
            expect(sampleDoc.layer.features[0].color).toBe('#ff0000');
            expect(updated.layer.features[1]).toBe(sampleDoc.layer.features[1]); // Untouched feature untouched
        });

        it('creates intermediate objects and arrays when setting on sparse target', () => {
            const initial: any = {};
            const updated = setNestedPath(initial, 'layer.features.0.color' as any, '#ffffff');

            expect(updated).toEqual({
                layer: {
                    features: [{ color: '#ffffff' }],
                },
            });
            expect(Array.isArray(updated.layer.features)).toBe(true);
        });

        it('returns original target when path is empty string', () => {
            const result = setNestedPath(sampleDoc, '' as any, 'value' as any);
            expect(result).toBe(sampleDoc);
        });
    });

    describe('5. Runtime deleteNestedPath Immutability & Deletions', () => {
        it('immutably removes top-level property', () => {
            const updated = deleteNestedPath(sampleDoc, 'title');

            expect(updated).not.toBe(sampleDoc);
            expect('title' in updated).toBe(false);
            expect('title' in sampleDoc).toBe(true);
            expect(sampleDoc.title).toBe('Map Layer 1');
        });

        it('immutably removes nested property', () => {
            const updated = deleteNestedPath(sampleDoc, 'metadata.author.email');

            expect(updated.metadata?.author.email).toBeUndefined();
            expect(sampleDoc.metadata?.author.email).toBe('alice@example.com');
            expect(updated.metadata?.author.name).toBe('Alice');
        });

        it('immutably splices array elements at index', () => {
            const updated = deleteNestedPath(sampleDoc, 'layer.features.0');

            expect(updated.layer.features.length).toBe(1);
            expect(updated.layer.features[0].id).toBe('f-2');
            expect(sampleDoc.layer.features.length).toBe(2);
            expect(sampleDoc.layer.features[0].id).toBe('f-1');
        });

        it('handles non-existent paths gracefully without mutating target', () => {
            const updated = deleteNestedPath(sampleDoc, 'nonexistent.key' as any);
            expect(updated).toEqual(sampleDoc);
            expect(sampleDoc.id).toBe('doc-1');
        });

        it('returns target when deleting on empty path or non-object', () => {
            expect(deleteNestedPath(sampleDoc, '' as any)).toBe(sampleDoc);
            expect(deleteNestedPath(null as any, 'id' as any)).toBeNull();
        });
    });
});
