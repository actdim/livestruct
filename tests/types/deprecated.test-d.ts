/**
 * @actdim/livestruct - Deprecated Aliases Type Test
 * Proves that deprecated exports (LiveSqliteEngine) remain exportable and compile cleanly.
 */

import { describe, it, expectTypeOf } from 'vitest';
import type { LiveDocEngine, LiveSqliteEngine } from '../../src/index';

describe('Deprecated Aliases Type Check', () => {
    it('proves LiveSqliteEngine is an alias for LiveDocEngine', () => {
        expectTypeOf<LiveSqliteEngine>().toEqualTypeOf<LiveDocEngine>();
    });
});
