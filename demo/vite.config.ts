import path from 'path';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';
import tsConfigPaths from 'vite-tsconfig-paths';
import config from './packageConfig';

export default defineConfig({
    // CI (GitHub Pages) sets DEMO_BASE=/livestruct/demo/; local dev and builds stay at `/`.
    base: process.env.DEMO_BASE || '/',
    resolve: {
        alias: config.resolveAliases(),
    },
    plugins: [
        react(),
        tsConfigPaths(),
    ],
    worker: {
        format: 'es',
    },
    optimizeDeps: {
        exclude: ['@livestore/wa-sqlite'],
    },
    server: {
        port: 4173,
        fs: {
            allow: [
                searchForWorkspaceRoot(process.cwd()),
                path.resolve(__dirname, '../../..'),
            ],
        },
    },
});
