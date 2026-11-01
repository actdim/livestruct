/**
 * Built-in LiveStore schema and SQLite materializers for LiveStruct.
 * Maintains a universal docs table with RFC 7396 merge patch support.
 */

import { Events, makeSchema, State } from '@livestore/livestore';
import { Schema } from 'effect';

/**
 * Universal SQLite table definition for all LiveStruct collections.
 * Key format: `${collection}\x01${id}` for unambiguous primary key resolution.
 */
export const docs = State.SQLite.table({
    name: 'docs',
    columns: {
        key: State.SQLite.text({ primaryKey: true }),
        collection: State.SQLite.text({ nullable: false }),
        id: State.SQLite.text({ nullable: false }),
        body: State.SQLite.text({ default: '{}', nullable: false }),
        rev: State.SQLite.integer({ default: 1, nullable: false }),
        updatedAt: State.SQLite.integer({ default: 0, nullable: false }),
        blobs: State.SQLite.text({ default: '{}', nullable: false }),
        mutationId: State.SQLite.text({ default: '', nullable: false }),
        origin: State.SQLite.text({ default: '', nullable: false }),
    },
    indexes: [
        {
            name: 'idx_docs_collection_updatedAt',
            columns: ['collection', 'updatedAt'],
        },
    ],
});

export const tables = { docs };

/**
 * LiveStore synced event definitions for LiveStruct document lifecycle.
 * All event names use the 'livestruct.v1.' namespace.
 */
export const events = {
    DocInserted: Events.synced({
        name: 'livestruct.v1.DocInserted',
        schema: Schema.Struct({
            collection: Schema.String,
            id: Schema.String,
            data: Schema.String,
            blobs: Schema.optional(Schema.String),
            mutationId: Schema.String,
            origin: Schema.String,
            updatedAt: Schema.Number,
        }),
    }),
    DocReplaced: Events.synced({
        name: 'livestruct.v1.DocReplaced',
        schema: Schema.Struct({
            collection: Schema.String,
            id: Schema.String,
            data: Schema.String,
            blobs: Schema.optional(Schema.String),
            mutationId: Schema.String,
            origin: Schema.String,
            updatedAt: Schema.Number,
        }),
    }),
    DocPatched: Events.synced({
        name: 'livestruct.v1.DocPatched',
        schema: Schema.Struct({
            collection: Schema.String,
            id: Schema.String,
            patch: Schema.String,
            blobs: Schema.optional(Schema.String),
            mutationId: Schema.String,
            origin: Schema.String,
            updatedAt: Schema.Number,
        }),
    }),
    DocPathSet: Events.synced({
        name: 'livestruct.v1.DocPathSet',
        schema: Schema.Struct({
            collection: Schema.String,
            id: Schema.String,
            path: Schema.String,
            value: Schema.String,
            mutationId: Schema.String,
            origin: Schema.String,
            updatedAt: Schema.Number,
        }),
    }),
    DocDeleted: Events.synced({
        name: 'livestruct.v1.DocDeleted',
        schema: Schema.Struct({
            collection: Schema.String,
            id: Schema.String,
            mutationId: Schema.String,
            origin: Schema.String,
            updatedAt: Schema.Number,
        }),
    }),
};

/**
 * Computes composite primary key for docs table.
 */
export function makeDocKey(collection: string, id: string): string {
    return `${collection}\u0001${id}`;
}

const materializers = State.SQLite.materializers(events, {
    'livestruct.v1.DocInserted': ({ collection, id, data, blobs, mutationId, origin, updatedAt }) => {
        const key = makeDocKey(collection, id);
        return {
            sql: 'INSERT INTO docs (key, collection, id, body, rev, updatedAt, blobs, mutationId, origin) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT (key) DO NOTHING',
            bindValues: [key, collection, id, data, updatedAt, blobs ?? '{}', mutationId, origin],
            writeTables: new Set(['docs']),
        };
    },

    'livestruct.v1.DocReplaced': ({ collection, id, data, blobs, mutationId, origin, updatedAt }) => {
        const key = makeDocKey(collection, id);
        return {
            sql: 'INSERT INTO docs (key, collection, id, body, rev, updatedAt, blobs, mutationId, origin) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET body = excluded.body, rev = docs.rev + 1, updatedAt = excluded.updatedAt, blobs = excluded.blobs, mutationId = excluded.mutationId, origin = excluded.origin',
            bindValues: [key, collection, id, data, updatedAt, blobs ?? '{}', mutationId, origin],
            writeTables: new Set(['docs']),
        };
    },

    'livestruct.v1.DocPatched': ({ collection, id, patch, blobs, mutationId, origin, updatedAt }) => {
        const key = makeDocKey(collection, id);
        if (blobs !== undefined) {
            return {
                sql: 'UPDATE docs SET body = json_patch(body, ?), rev = rev + 1, updatedAt = ?, blobs = ?, mutationId = ?, origin = ? WHERE key = ?',
                bindValues: [patch, updatedAt, blobs, mutationId, origin, key],
                writeTables: new Set(['docs']),
            };
        }
        return {
            sql: 'UPDATE docs SET body = json_patch(body, ?), rev = rev + 1, updatedAt = ?, mutationId = ?, origin = ? WHERE key = ?',
            bindValues: [patch, updatedAt, mutationId, origin, key],
            writeTables: new Set(['docs']),
        };
    },

    'livestruct.v1.DocPathSet': ({ collection, id, path, value, mutationId, origin, updatedAt }) => {
        const key = makeDocKey(collection, id);
        return {
            sql: 'UPDATE docs SET body = json_set(body, ?, json(?)), rev = rev + 1, updatedAt = ?, mutationId = ?, origin = ? WHERE key = ?',
            bindValues: [path, value, updatedAt, mutationId, origin, key],
            writeTables: new Set(['docs']),
        };
    },

    'livestruct.v1.DocDeleted': ({ collection, id }) => {
        const key = makeDocKey(collection, id);
        return {
            sql: 'DELETE FROM docs WHERE key = ?',
            bindValues: [key],
            writeTables: new Set(['docs']),
        };
    },
});

export const state = State.SQLite.makeState({ tables, materializers });
export const schema = makeSchema({ state, events });
