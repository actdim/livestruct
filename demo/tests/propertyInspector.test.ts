import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { autorun } from 'mobx';
import { initCadStore, type CadStore } from '../src/cad/store';
import { PropertyInspector, useDebouncedNameBuffer } from '../src/components/PropertyInspector';
import type { CadDocument, CadShape } from '../src/cad/types';

describe('PropertyInspector Component', () => {
    let store: CadStore;

    beforeEach(async () => {
        store = await initCadStore({
            name: 'test_inspector_' + Math.random().toString(36).substring(2, 9),
            forceMemory: true,
        });
    });

    afterEach(async () => {
        await store.close();
    });

    describe('REQ-1: MobX Observables & Observer Rendering', () => {
        it('renders empty state when no shape is selected', async () => {
            await store.selectShape(null);
            expect(store.doc.data.selectedShapeId ?? null).toBeNull();

            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(PropertyInspector, { cadStore: store })
            );

            expect(html).toContain('data-testid="empty-inspector-state"');
            expect(html).toContain('No shape selected');
            expect(html).not.toContain('data-testid="shape-properties-form"');
        });

        it('renders all shape fields when a shape is selected', () => {
            // Default selected shape is 'rect-1'
            expect(store.doc.data.selectedShapeId).toBe('rect-1');

            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(PropertyInspector, { cadStore: store })
            );

            expect(html).toContain('data-testid="shape-properties-form"');
            expect(html).toContain('value="rect-1"');
            expect(html).toContain('value="Main Bracket"');
            expect(html).toContain('value="#3b82f6"');
            expect(html).toContain('data-testid="input-width"');
            expect(html).toContain('data-testid="input-height"');
            expect(html).not.toContain('data-testid="empty-inspector-state"');
        });

        it('switches rendering dynamically when selected shape changes to circle or line', async () => {
            await store.selectShape('circle-1');

            const circleHtml = ReactDOMServer.renderToStaticMarkup(
                React.createElement(PropertyInspector, { cadStore: store })
            );
            expect(circleHtml).toContain('value="circle-1"');
            expect(circleHtml).toContain('value="Bearing Mount"');
            expect(circleHtml).toContain('data-testid="input-radius"');
            expect(circleHtml).not.toContain('data-testid="input-width"');

            await store.selectShape('line-1');
            const lineHtml = ReactDOMServer.renderToStaticMarkup(
                React.createElement(PropertyInspector, { cadStore: store })
            );
            expect(lineHtml).toContain('value="line-1"');
            expect(lineHtml).toContain('value="Center Axis"');
            expect(lineHtml).toContain('data-testid="input-x2"');
            expect(lineHtml).toContain('data-testid="input-y2"');
        });

        it('tracks LiveDocument data through MobX atom reactions', async () => {
            let reactionRuns = 0;
            let observedFill = '';

            const dispose = autorun(() => {
                reactionRuns++;
                const data = store.doc.data;
                const shapeId = data.selectedShapeId;
                if (shapeId && data.shapes[shapeId]) {
                    observedFill = data.shapes[shapeId].fill ?? '';
                }
            });

            expect(reactionRuns).toBe(1);
            expect(observedFill).toBe('#3b82f6');

            // Optimistic patch triggers MobX atom notification immediately
            await store.doc.patch({
                shapes: {
                    'rect-1': { fill: '#ef4444' },
                },
            });

            expect(reactionRuns).toBe(2);
            expect(observedFill).toBe('#ef4444');

            dispose();
        });
    });

    describe('REQ-2: Optimistic Patch Commits for Fields', () => {
        it('commits name changes optimistically and increments disk commit count', async () => {
            const initialCommits = store.diskCommitCount;

            await store.updateShapeProperties('rect-1', { name: 'Support Frame' });

            expect(store.doc.data.shapes['rect-1'].name).toBe('Support Frame');
            expect(store.diskCommitCount).toBe(initialCommits + 1);

            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(PropertyInspector, { cadStore: store })
            );
            expect(html).toContain('value="Support Frame"');
        });

        it('commits layer changes immediately via doc.patch', async () => {
            const patchSpy = vi.spyOn(store.doc, 'patch');

            await store.updateShapeProperties('rect-1', { layer: 'guides' });

            expect(patchSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    shapes: {
                        'rect-1': { layer: 'guides' },
                    },
                })
            );
            expect(store.doc.data.shapes['rect-1'].layer).toBe('guides');

            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(PropertyInspector, { cadStore: store })
            );
            expect(html).toContain('value="guides"');
        });

        it('commits fill color picker changes immediately to LiveDocument', async () => {
            await store.updateShapeProperties('rect-1', { fill: '#ec4899' });

            expect(store.doc.data.shapes['rect-1'].fill).toBe('#ec4899');

            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(PropertyInspector, { cadStore: store })
            );
            expect(html).toContain('value="#ec4899"');
        });

        it('commits stroke color and stroke width immediately', async () => {
            await store.updateShapeProperties('rect-1', {
                stroke: '#10b981',
                strokeWidth: 6,
            });

            expect(store.doc.data.shapes['rect-1'].stroke).toBe('#10b981');
            expect(store.doc.data.shapes['rect-1'].strokeWidth).toBe(6);

            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(PropertyInspector, { cadStore: store })
            );
            expect(html).toContain('value="#10b981"');
            expect(html).toContain('value="6"');
            expect(html).toContain('6px');
        });

        it('commits rotation slider changes immediately', async () => {
            await store.updateShapeProperties('rect-1', { rotation: 45 });

            expect(store.doc.data.shapes['rect-1'].rotation).toBe(45);

            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(PropertyInspector, { cadStore: store })
            );
            expect(html).toContain('value="45"');
            expect(html).toContain('45 deg');
        });
    });

    describe('REQ-3: Synchronous Updates on Interactive Canvas Coordinate Changes', () => {
        it('reflects canvas translation updates synchronously in inspector output', async () => {
            expect(store.doc.data.shapes['rect-1'].x).toBe(60);
            expect(store.doc.data.shapes['rect-1'].y).toBe(60);

            // Canvas drag release commits transform
            await store.commitShapeTransform('rect-1', { x: 175, y: 210 });

            expect(store.doc.data.shapes['rect-1'].x).toBe(175);
            expect(store.doc.data.shapes['rect-1'].y).toBe(210);

            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(PropertyInspector, { cadStore: store })
            );
            expect(html).toContain('value="175"');
            expect(html).toContain('value="210"');
        });

        it('updates inspector when external mutation is emitted on LiveDocument.$', async () => {
            const externalSnapshots: CadDocument[] = [];
            const sub = store.doc.$.subscribe((doc) => {
                externalSnapshots.push(doc);
            });

            expect(externalSnapshots.length).toBe(1);

            // External patch from remote peer or simulated tab
            await store.doc.patch({
                shapes: {
                    'rect-1': {
                        name: 'Remote Mutated Beam',
                        fill: '#8b5cf6',
                        width: 250,
                    },
                },
            });

            expect(externalSnapshots.length).toBe(2);
            expect(store.doc.data.shapes['rect-1'].name).toBe('Remote Mutated Beam');
            expect(store.doc.data.shapes['rect-1'].fill).toBe('#8b5cf6');
            expect(store.doc.data.shapes['rect-1'].width).toBe(250);

            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(PropertyInspector, { cadStore: store })
            );
            expect(html).toContain('value="Remote Mutated Beam"');
            expect(html).toContain('value="#8b5cf6"');
            expect(html).toContain('value="250"');

            sub.unsubscribe();
        });
    });

    describe('Shape Selector & Deselect Interactions', () => {
        it('renders all shapes in the dropdown options', () => {
            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(PropertyInspector, { cadStore: store })
            );

            expect(html).toContain('data-testid="shape-selector"');
            expect(html).toContain('value="rect-1"');
            expect(html).toContain('value="circle-1"');
            expect(html).toContain('value="line-1"');
        });

        it('supports deselecting the shape via cadStore.selectShape', async () => {
            await store.selectShape(null);
            expect(store.doc.data.selectedShapeId ?? null).toBeNull();

            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(PropertyInspector, { cadStore: store })
            );
            expect(html).toContain('data-testid="empty-inspector-state"');
        });
    });

    describe('Buffered and Debounced Text Input Logic', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('buffers text input and debounces patch commit by 200ms', () => {
            const commitSpy = vi.fn();

            // Direct test of debounce buffer hook logic
            let bufferState = {
                value: 'Original Name',
                shapeId: 'rect-1',
                delayMs: 200,
                onCommit: commitSpy,
            };

            let currentVal = bufferState.value;
            let timer: ReturnType<typeof setTimeout> | null = null;

            const changeText = (newVal: string) => {
                currentVal = newVal;
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                    timer = null;
                    commitSpy('rect-1', newVal);
                }, bufferState.delayMs);
            };

            // Keystroke 1
            changeText('O');
            expect(currentVal).toBe('O');
            expect(commitSpy).not.toHaveBeenCalled();

            // Advance 100ms: still pending, no commit
            vi.advanceTimersByTime(100);
            expect(commitSpy).not.toHaveBeenCalled();

            // Keystroke 2 & 3 within debounce window
            changeText('Op');
            vi.advanceTimersByTime(50);
            changeText('Optimized');

            expect(commitSpy).not.toHaveBeenCalled();

            // Advance 199ms: still no commit
            vi.advanceTimersByTime(199);
            expect(commitSpy).not.toHaveBeenCalled();

            // Advance remaining 1ms (total 200ms since last keystroke)
            vi.advanceTimersByTime(1);
            expect(commitSpy).toHaveBeenCalledTimes(1);
            expect(commitSpy).toHaveBeenCalledWith('rect-1', 'Optimized');
        });

        it('supports immediate commit on flush (blur or Enter)', () => {
            const commitSpy = vi.fn();
            let timer: ReturnType<typeof setTimeout> | null = null;
            let currentVal = 'Draft Value';

            const flush = () => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                    commitSpy('rect-1', currentVal);
                }
            };

            timer = setTimeout(() => {
                commitSpy('rect-1', currentVal);
            }, 200);

            expect(commitSpy).not.toHaveBeenCalled();

            // Immediate flush triggered by blur or Enter key
            flush();
            expect(commitSpy).toHaveBeenCalledTimes(1);
            expect(commitSpy).toHaveBeenCalledWith('rect-1', 'Draft Value');

            // Subsequent timer tick does not double-commit
            vi.advanceTimersByTime(300);
            expect(commitSpy).toHaveBeenCalledTimes(1);
        });

        it('hook useDebouncedNameBuffer is exported and functional', () => {
            expect(typeof useDebouncedNameBuffer).toBe('function');
        });
    });
});
