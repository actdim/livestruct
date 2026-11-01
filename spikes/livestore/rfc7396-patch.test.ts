import { describe, it, expect } from 'vitest';
import { makeInMemoryAdapter } from '@livestore/adapter-web';
import { createStorePromise } from '@livestore/livestore';
import { schema, tables, events } from './schema';

describe('RFC 7396 Merge Patch Materializer (Q3)', () => {
    it('verifies json_patch(body, ?) handles nested objects, null deletes, and array replacement', async () => {
        const store = await createStorePromise({
            schema,
            storeId: 'rfc7396-test',
            adapter: makeInMemoryAdapter(),
            confirmUnsavedChanges: false,
            disableDevtools: true,
        });

        // 1. Initial Document
        const initialDoc = {
            title: 'Initial Document',
            metadata: {
                version: 1,
                author: 'Pavel',
                tags: ['alpha', 'beta'],
            },
            viewport: {
                zoom: 1.0,
                center: { x: 100, y: 200 },
            },
            items: [1, 2, 3],
        };

        store.commit(events.docCreated({
            id: 'doc-rfc-1',
            body: JSON.stringify(initialDoc),
            mutationId: 'init-1',
            origin: 'session-1',
        }));

        let row = store.query(tables.docs.where({ id: 'doc-rfc-1' }))[0];
        expect(JSON.parse(row.body)).toEqual(initialDoc);

        // 2. Nested update + Null delete + Array replacement
        // - title: updated
        // - metadata.version: updated
        // - metadata.author: deleted via null
        // - viewport.center.x: updated, center.y: preserved!
        // - items: replaced with [10, 20]
        const patch = {
            title: 'Updated Document',
            metadata: {
                version: 2,
                author: null, // RFC 7396 delete
            },
            viewport: {
                center: { x: 150 }, // nested object merge
            },
            items: [10, 20], // array replacement
        };

        store.commit(events.docPatched({
            id: 'doc-rfc-1',
            patch: JSON.stringify(patch),
            mutationId: 'patch-1',
            origin: 'session-1',
        }));

        row = store.query(tables.docs.where({ id: 'doc-rfc-1' }))[0];
        const parsed = JSON.parse(row.body);

        // Assertions
        expect(parsed.title).toBe('Updated Document');
        expect(parsed.metadata.version).toBe(2);
        expect('author' in parsed.metadata).toBe(false); // key removed
        expect(parsed.metadata.tags).toEqual(['alpha', 'beta']); // preserved!
        expect(parsed.viewport.zoom).toBe(1.0); // preserved!
        expect(parsed.viewport.center).toEqual({ x: 150, y: 200 }); // nested merge: x updated, y preserved!
        expect(parsed.items).toEqual([10, 20]); // array replaced!

        // 3. Compare with JS merge materializer parity
        store.commit(events.docCreated({
            id: 'doc-js-1',
            body: JSON.stringify(initialDoc),
            mutationId: 'init-2',
            origin: 'session-1',
        }));

        store.commit(events.docPatchedJs({
            id: 'doc-js-1',
            patch: JSON.stringify(patch),
            mutationId: 'patch-js-1',
            origin: 'session-1',
        }));

        const jsRow = store.query(tables.docs.where({ id: 'doc-js-1' }))[0];
        const jsParsed = JSON.parse(jsRow.body);

        expect(jsParsed).toEqual(parsed);

        await store.shutdown();
    });

    it('measures execution time: json_patch SQL vs JS read-merge-write materializer', async () => {
        const store = await createStorePromise({
            schema,
            storeId: 'rfc7396-bench',
            adapter: makeInMemoryAdapter(),
            confirmUnsavedChanges: false,
            disableDevtools: true,
        });

        const N = 500;
        const initialDoc = { count: 0, nested: { val: 0, tag: 'demo' }, list: [1, 2] };

        store.commit(events.docCreated({
            id: 'bench-sql',
            body: JSON.stringify(initialDoc),
            mutationId: 'b-0',
            origin: 'bench',
        }));

        store.commit(events.docCreated({
            id: 'bench-js',
            body: JSON.stringify(initialDoc),
            mutationId: 'b-0',
            origin: 'bench',
        }));

        // Measure json_patch (raw SQL)
        const t0Sql = performance.now();
        for (let i = 1; i <= N; i++) {
            store.commit(events.docPatched({
                id: 'bench-sql',
                patch: JSON.stringify({ count: i, nested: { val: i } }),
                mutationId: `sql-${i}`,
                origin: 'bench',
            }));
        }
        const t1Sql = performance.now();
        const durationSqlMs = t1Sql - t0Sql;
        const avgSqlUs = ((durationSqlMs / N) * 1000).toFixed(1);

        // Measure JS merge (ctx.query + JSON.parse + JS merge + JSON.stringify + write)
        const t0Js = performance.now();
        for (let i = 1; i <= N; i++) {
            store.commit(events.docPatchedJs({
                id: 'bench-js',
                patch: JSON.stringify({ count: i, nested: { val: i } }),
                mutationId: `js-${i}`,
                origin: 'bench',
            }));
        }
        const t1Js = performance.now();
        const durationJsMs = t1Js - t0Js;
        const avgJsUs = ((durationJsMs / N) * 1000).toFixed(1);

        console.log(`[Q3 Benchmark] ${N} commits:`);
        console.log(`  json_patch (raw SQL) : ${durationSqlMs.toFixed(2)} ms total, ${avgSqlUs} µs / commit`);
        console.log(`  JS read-merge-write  : ${durationJsMs.toFixed(2)} ms total, ${avgJsUs} µs / commit`);

        // Both produced exact same final state
        const sqlBody = JSON.parse(store.query(tables.docs.where({ id: 'bench-sql' }))[0].body);
        const jsBody = JSON.parse(store.query(tables.docs.where({ id: 'bench-js' }))[0].body);
        expect(sqlBody).toEqual(jsBody);
        expect(sqlBody.count).toBe(N);
        expect(sqlBody.nested.val).toBe(N);
        expect(sqlBody.nested.tag).toBe('demo');

        await store.shutdown();
    });
});
