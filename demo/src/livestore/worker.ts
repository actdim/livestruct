import '@livestore/adapter-web/worker-vite-dev-polyfill';
import { makeWorker } from '@livestore/adapter-web/worker';
import { schema } from '@actdim/livestruct/engine';

makeWorker({ schema });
