import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { createRequire } from 'module';
import config from './packageConfig';

const require = createRequire(import.meta.url);
const waSqliteNodePath = require.resolve('@livestore/wa-sqlite/dist/wa-sqlite.node.mjs');

export default defineConfig({
    test: {
        watch: false,
        reporters: 'verbose',
        name: 'node',
        globals: true,
        setupFiles: [resolve('./vitest.setup.ts')],
        isolate: false,
        pool: 'forks',
        environment: 'node',
        include: ['tests/**/*.{test,spec}.ts', 'spikes/**/*.{test,spec}.ts'],
        exclude: ['tests/browser/**', 'node_modules/**', 'dist/**'],
        includeSource: ['src/**/*.ts'],
        typecheck: {
            tsconfig: 'tsconfig.dev.json',
        },
        root: resolve('.'),
    },
    resolve: {
        alias: {
            ...config.resolveAliases(),
            '@livestore/wa-sqlite/dist/wa-sqlite.mjs': waSqliteNodePath,
        },
    },
    base: './',
});
