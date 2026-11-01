import { Events, makeSchema, State } from '@livestore/livestore';
import { Schema } from 'effect';

// Universal docs table for LiveStruct documents
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
    docPatchedJs: Events.synced({
        name: 'doc.patchedJs',
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

// RFC 7396 merge patch in JavaScript for Q3 comparison
export function applyJsonMergePatchJs(target: any, patch: any): any {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        return patch;
    }
    const result = typeof target === 'object' && target !== null && !Array.isArray(target)
        ? { ...target }
        : {};
    for (const key of Object.keys(patch)) {
        const patchVal = patch[key];
        if (patchVal === null) {
            delete result[key];
        } else {
            result[key] = applyJsonMergePatchJs(result[key], patchVal);
        }
    }
    return result;
}

const materializers = State.SQLite.materializers(events, {
    'doc.created': ({ id, body, mutationId, origin }) =>
        tables.docs.insert({ id, body, mutation_id: mutationId, origin }),

    // RFC 7396 merge patch via SQLite json_patch() function
    'doc.patched': ({ id, patch, mutationId, origin }) => ({
        sql: 'UPDATE docs SET body = json_patch(body, ?), mutation_id = ?, origin = ? WHERE id = ?',
        bindValues: [patch, mutationId, origin, id],
        writeTables: new Set(['docs']),
    }),

    // JS merge alternative for benchmark comparison in Q3
    'doc.patchedJs': ({ id, patch, mutationId, origin }, ctx) => {
        const existing = ctx.query({
            query: 'SELECT body FROM docs WHERE id = $id',
            bindValues: { id },
        }) as Array<{ body: string }>;
        const currentTarget = existing.length > 0 ? JSON.parse(existing[0].body) : {};
        const merged = applyJsonMergePatchJs(currentTarget, JSON.parse(patch));
        return {
            sql: 'UPDATE docs SET body = $body, mutation_id = $mutationId, origin = $origin WHERE id = $id',
            bindValues: { id, body: JSON.stringify(merged), mutationId, origin },
            writeTables: new Set(['docs']),
        };
    },

    'doc.deleted': ({ id }) =>
        tables.docs.delete().where({ id }),
});

export const state = State.SQLite.makeState({ tables, materializers });
export const schema = makeSchema({ state, events });
