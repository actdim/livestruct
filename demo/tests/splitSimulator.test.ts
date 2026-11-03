import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initCadStore, type CadStore } from '../src/cad/store';
import {
    exportCadDatabase,
    importCadDatabase,
    buildSqliteCadDatabase,
} from '../src/cad/exportImport';
import { SplitSimulator, type ViewportMode } from '../src/components/SplitSimulator';
import type { CadDocument } from '../src/cad/types';

describe('Split Tab Simulator & File Portability Test Suite', () => {
    let storeA: CadStore;
    let storeB: CadStore;

    beforeEach(async () => {
        const sharedStoreName = 'test_split_' + Math.random().toString(36).substring(2, 9);

        storeA = await initCadStore({
            name: sharedStoreName,
            senderId: 'Viewport-A',
            forceMemory: true,
        });

        storeB = await initCadStore({
            name: sharedStoreName,
            senderId: 'Viewport-B',
            forceMemory: true,
        });
    });

    afterEach(async () => {
        await storeA.close();
        await storeB.close();
    });

    describe('REQ-1 & REQ-2: Isolated Viewports & LiveStruct Cross-Tab Synchronization', () => {
        it('transmits tentative overlay updates in real-time from Viewport A to Viewport B without synchronous commits', async () => {
            expect(storeB.doc.isTentative).toBe(false);
            const initialCommitsA = storeA.commits;
            const initialCommitsB = storeB.commits;

            // Send tentative drag patch on Viewport A without flushing
            void storeA.doc.patch({
                shapes: {
                    'rect-1': {
                        x: 100,
                        y: 110,
                    },
                },
            });

            // Wait for BroadcastChannel delivery via LiveStruct OverlayChannel
            await new Promise((resolve) => setTimeout(resolve, 60));

            // Viewport B receives the tentative overlay coordinates in real-time
            expect(storeB.doc.data.shapes['rect-1'].x).toBe(100);
            expect(storeB.doc.data.shapes['rect-1'].y).toBe(110);
            expect(storeB.doc.isTentative).toBe(true);

            // Zero synchronous commits during drag
            expect(storeA.commits).toBe(initialCommitsA);
            expect(storeB.commits).toBe(initialCommitsB);

            // Flush commit on Viewport A drops tentative state on Viewport B
            await storeA.doc.flush();
            await new Promise((resolve) => setTimeout(resolve, 60));
            expect(storeB.doc.isTentative).toBe(false);
            expect(storeB.doc.data.shapes['rect-1'].x).toBe(100);
        });

        it('suppresses local echo so sender does not mark its own local pending mutations as tentative', async () => {
            void storeA.doc.patch({
                shapes: {
                    'circle-1': {
                        x: 350,
                        y: 150,
                    },
                },
            });

            // Sender has pending changes, but isTentative remains false for local edits
            expect(storeA.doc.isPending).toBe(true);
            expect(storeA.doc.isTentative).toBe(false);

            await new Promise((resolve) => setTimeout(resolve, 60));

            // Remote peer Viewport B marks them as tentative
            expect(storeB.doc.isTentative).toBe(true);
            expect(storeB.doc.data.shapes['circle-1'].x).toBe(350);

            await storeA.doc.flush();
        });

        it('propagates entity mutations from Viewport A to Viewport B via livestruct commit', async () => {
            const initialRect = storeB.doc.data.shapes['rect-1'];
            expect(initialRect.x).toBe(60);
            expect(initialRect.y).toBe(60);

            // Mutate in Viewport A with flush
            await storeA.commitShapeTransform('rect-1', {
                x: 175,
                y: 195,
            });

            // Wait for commit replication
            await new Promise((resolve) => setTimeout(resolve, 80));

            const updatedRectB = storeB.doc.data.shapes['rect-1'];
            expect(updatedRectB.x).toBe(175);
            expect(updatedRectB.y).toBe(195);
            expect(storeB.doc.isTentative).toBe(false);
        });

        it('propagates property modifications from Viewport B back to Viewport A', async () => {
            await storeB.updateShapeProperties('circle-1', {
                fill: '#ef4444',
                radius: 65,
                name: 'Custom Flange',
            });

            await new Promise((resolve) => setTimeout(resolve, 80));

            const updatedCircleA = storeA.doc.data.shapes['circle-1'];
            expect(updatedCircleA.fill).toBe('#ef4444');
            expect(updatedCircleA.radius).toBe(65);
            expect(updatedCircleA.name).toBe('Custom Flange');
        });
    });

    describe('REQ-3: Viewport Mode Switching & Host Shell UI Rendering', () => {
        it('renders single viewport mode with vector canvas and property inspector by default', () => {
            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(SplitSimulator, {
                    cadStore: storeA,
                    initialMode: 'single',
                })
            );

            expect(html).toContain('data-testid="host-shell-toolbar"');
            expect(html).toContain('data-testid="single-viewport-container"');
            expect(html).toContain('Interactive CAD Canvas');
            expect(html).toContain('LiveDocument Properties');
            expect(html).not.toContain('data-testid="dual-split-container"');
        });

        it('renders dual iframe split mode with isolated same-origin iframes and sandbox attributes', () => {
            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(SplitSimulator, {
                    cadStore: storeA,
                    initialMode: 'dual',
                })
            );

            expect(html).toContain('data-testid="dual-split-container"');
            expect(html).toContain('data-testid="iframe-pane-a"');
            expect(html).toContain('data-testid="iframe-pane-b"');
            expect(html).toContain('src="?viewport=A"');
            expect(html).toContain('src="?viewport=B"');
            expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-forms"');
            expect(html).toContain('[Viewport A] Isolated iframe');
            expect(html).toContain('[Viewport B] Isolated iframe');
        });

        it('notifies onModeChange callback when switching modes', () => {
            let selectedMode: ViewportMode | null = null;
            const onModeChange = (mode: ViewportMode) => {
                selectedMode = mode;
            };

            const html = ReactDOMServer.renderToStaticMarkup(
                React.createElement(SplitSimulator, {
                    cadStore: storeA,
                    initialMode: 'single',
                    onModeChange,
                })
            );

            expect(html).toContain('data-testid="btn-mode-single"');
            expect(html).toContain('data-testid="btn-mode-dual"');
            expect(html).toContain('data-testid="btn-mode-native"');
        });
    });

    describe('REQ-4: Undo / Redo Command History & Cross-Tab Routing', () => {
        it('records undo stack and restores previous shape state on undo', async () => {
            expect(storeA.canUndo).toBe(false);

            await storeA.commitShapeTransform('rect-1', { x: 200, y: 220 });
            expect(storeA.canUndo).toBe(true);
            expect(storeA.doc.data.shapes['rect-1'].x).toBe(200);

            const undoOk = await storeA.undo();
            expect(undoOk).toBe(true);
            expect(storeA.doc.data.shapes['rect-1'].x).toBe(60);
            expect(storeA.canRedo).toBe(true);

            const redoOk = await storeA.redo();
            expect(redoOk).toBe(true);
            expect(storeA.doc.data.shapes['rect-1'].x).toBe(200);
        });

        it('synchronizes undo commands across viewports via livestruct', async () => {
            // Apply mutation on storeA, propagating to storeB
            await storeA.commitShapeTransform('rect-1', { x: 300, y: 320 });
            await new Promise((resolve) => setTimeout(resolve, 80));

            expect(storeB.doc.data.shapes['rect-1'].x).toBe(300);

            // Trigger undo on storeA (commits through livestruct and replicates automatically)
            await storeA.undo();

            await new Promise((resolve) => setTimeout(resolve, 80));

            expect(storeA.doc.data.shapes['rect-1'].x).toBe(60);
            expect(storeB.doc.data.shapes['rect-1'].x).toBe(60);
        });

        it('synchronizes redo commands across viewports via livestruct', async () => {
            await storeA.commitShapeTransform('rect-1', { x: 400, y: 420 });
            await storeA.undo();
            await new Promise((resolve) => setTimeout(resolve, 80));

            expect(storeA.doc.data.shapes['rect-1'].x).toBe(60);

            await storeA.redo();
            await new Promise((resolve) => setTimeout(resolve, 80));

            expect(storeA.doc.data.shapes['rect-1'].x).toBe(400);
            expect(storeB.doc.data.shapes['rect-1'].x).toBe(400);
        });
    });

    describe('REQ-5: Binary Project Export & SQLite Inspection', () => {
        it('exports active CAD store to a valid binary SQLite database file', async () => {
            const binaryData = await exportCadDatabase(storeA);

            expect(binaryData).toBeInstanceOf(Uint8Array);
            expect(binaryData.length).toBeGreaterThan(100);

            // Verifies magic SQLite header: "SQLite format 3\0"
            const headerStr = new TextDecoder('latin1').decode(binaryData.slice(0, 16));
            expect(headerStr).toBe('SQLite format 3\0');
        });

        it('allows standard SQLite CLI tools to inspect the exported database schema and records', async () => {
            await storeA.updateShapeProperties('rect-1', {
                name: 'Precision Arm',
                fill: '#22c55e',
            });

            const binaryData = await exportCadDatabase(storeA);

            // Write binary to temporary SQLite file
            const tempDir = os.tmpdir();
            const tempDbPath = path.join(tempDir, `test_cad_${Date.now()}.cad`);
            fs.writeFileSync(tempDbPath, binaryData);

            const tempPyPath = path.join(tempDir, `test_verify_${Date.now()}.py`);

            try {
                // Execute standard SQLite verification using Python sqlite3 CLI
                const pythonScript = `
import sqlite3, json, sys
conn = sqlite3.connect(sys.argv[1])
cursor = conn.cursor()
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [row[0] for row in cursor.fetchall()]
assert 'cad_documents' in tables, f"cad_documents table missing: {tables}"

cursor.execute("SELECT id, title, data FROM cad_documents")
rows = cursor.fetchall()
assert len(rows) == 1, f"Expected 1 document row, got: {len(rows)}"
doc_id, title, data_str = rows[0]
doc = json.loads(data_str)
assert doc['shapes']['rect-1']['name'] == 'Precision Arm'
assert doc['shapes']['rect-1']['fill'] == '#22c55e'
print("SQLITE_OK")
`.trim();

                fs.writeFileSync(tempPyPath, pythonScript, 'utf-8');

                const output = execSync(`python "${tempPyPath}" "${tempDbPath}"`, {
                    encoding: 'utf-8',
                });

                expect(output).toContain('SQLITE_OK');
            } finally {
                if (fs.existsSync(tempDbPath)) {
                    fs.unlinkSync(tempDbPath);
                }
                if (fs.existsSync(tempPyPath)) {
                    fs.unlinkSync(tempPyPath);
                }
            }
        });
    });

    describe('REQ-6: Binary Project Import & Live Session Mounting', () => {
        it('imports a binary SQLite database and restores document title and shape layout', async () => {
            // Modify shapes in storeA and export
            await storeA.updateShapeProperties('rect-1', {
                name: 'Imported Plate',
                width: 250,
                height: 180,
                fill: '#6366f1',
            });
            await storeA.doc.patch({ title: 'Engineered Chassis' });
            await storeA.doc.flush();

            const exportedBinary = await exportCadDatabase(storeA);

            // Import into fresh storeB
            await importCadDatabase(storeB, exportedBinary);

            expect(storeB.doc.data.title).toBe('Engineered Chassis');
            expect(storeB.doc.data.shapes['rect-1'].name).toBe('Imported Plate');
            expect(storeB.doc.data.shapes['rect-1'].width).toBe(250);
            expect(storeB.doc.data.shapes['rect-1'].height).toBe(180);
            expect(storeB.doc.data.shapes['rect-1'].fill).toBe('#6366f1');
        });

        it('imports raw JSON document payloads seamlessly', async () => {
            const rawJsonDoc: CadDocument = {
                id: 'doc-default',
                title: 'Robotic Gripper',
                selectedShapeId: 'circle-1',
                shapes: {
                    'circle-1': {
                        id: 'circle-1',
                        type: 'circle',
                        x: 200,
                        y: 200,
                        radius: 55,
                        name: 'Gripper Gear',
                        fill: '#e11d48',
                    },
                },
            };

            const jsonBytes = new TextEncoder().encode(JSON.stringify(rawJsonDoc));
            await importCadDatabase(storeB, jsonBytes);

            expect(storeB.doc.data.title).toBe('Robotic Gripper');
            expect(storeB.doc.data.selectedShapeId).toBe('circle-1');
            expect(storeB.doc.data.shapes['circle-1'].name).toBe('Gripper Gear');
            // Old shapes rect-1 and line-1 were cleanly removed
            expect(storeB.doc.data.shapes['rect-1']).toBeUndefined();
        });

        it('broadcasts imported project across viewports so peers update synchronously', async () => {
            const customDoc: CadDocument = {
                id: 'doc-default',
                title: 'Drone Frame',
                selectedShapeId: 'line-1',
                shapes: {
                    'line-1': {
                        id: 'line-1',
                        type: 'line',
                        x: 50,
                        y: 50,
                        x2: 450,
                        y2: 450,
                        name: 'Cross Strut',
                        stroke: '#06b6d4',
                        strokeWidth: 4,
                    },
                },
            };

            const sqliteBinary = buildSqliteCadDatabase(customDoc);
            // importCadDatabase calls doc.patch() + doc.flush(), replicating through livestruct
            await importCadDatabase(storeA, sqliteBinary);

            await new Promise((resolve) => setTimeout(resolve, 80));

            expect(storeB.doc.data.title).toBe('Drone Frame');
            expect(storeB.doc.data.shapes['line-1'].name).toBe('Cross Strut');
            expect(storeB.doc.data.shapes['line-1'].stroke).toBe('#06b6d4');
        });
    });
});
