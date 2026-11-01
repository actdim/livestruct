import '@livestore/adapter-web/worker-vite-dev-polyfill';
import { makeWorker } from '@livestore/adapter-web/worker';
import { schema } from './schema';

makeWorker({ schema });
