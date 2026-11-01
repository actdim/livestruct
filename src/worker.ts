/**
 * LiveStruct Dedicated Leader Worker entry point.
 * Hosts the SQLite OPFS persistent state and coordinates transactions.
 */

import '@livestore/adapter-web/worker-vite-dev-polyfill';
import { makeWorker } from '@livestore/adapter-web/worker';
import { schema } from './engine/schema';

makeWorker({ schema });
