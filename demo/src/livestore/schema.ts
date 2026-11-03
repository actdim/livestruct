import { Events, makeSchema, State } from '@livestore/livestore';
import { Schema } from 'effect';

export const docs = State.SQLite.table({
    name: 'docs',
    columns: {
        id: State.SQLite.text({ primaryKey: true }),
        body: State.SQLite.text({ default: '{}', nullable: false }),
        mutation_id: State.SQLite.text({ default: '', nullable: false }),
        origin: State.SQLite.text({ default: '', nullable: false }),
    },
});

export const tables = { docs };

export const events = {
    docCreated: Events.synced({
        name: 'doc.created',
        schema: Schema.Struct({
            id: Schema.String,
            body: Schema.String,
            mutationId: Schema.String,
            origin: Schema.String,
        }),
    }),
    docPatched: Events.synced({
        name: 'doc.patched',
        schema: Schema.Struct({
            id: Schema.String,
            patch: Schema.String,
            mutationId: Schema.String,
            origin: Schema.String,
        }),
    }),
    docDeleted: Events.synced({
        name: 'doc.deleted',
        schema: Schema.Struct({
            id: Schema.String,
            mutationId: Schema.String,
            origin: Schema.String,
        }),
    }),
};

const materializers = State.SQLite.materializers(events, {
    'doc.created': ({ id, body, mutationId, origin }) =>
        tables.docs.insert({ id, body, mutation_id: mutationId, origin }),

    'doc.patched': ({ id, patch, mutationId, origin }) => ({
        sql: 'UPDATE docs SET body = json_patch(body, ?), mutation_id = ?, origin = ? WHERE id = ?',
        bindValues: [patch, mutationId, origin, id],
        writeTables: new Set(['docs']),
    }),

    'doc.deleted': ({ id }) =>
        tables.docs.delete().where({ id }),
});

export const state = State.SQLite.makeState({ tables, materializers });
export const schema = makeSchema({ state, events });
