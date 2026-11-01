/**
 * @actdim/livestruct - MobX Observable Document Helper
 * Wraps LiveDocument in a reactive Proxy enabling property-level MobX observation
 * and direct property mutations triggering asynchronous patches.
 */

import type { LiveDocument, ObservableLiveDocument } from './types';

const proxyCache = new WeakMap<LiveDocument<any>, ObservableLiveDocument<any>>();

/**
 * Creates or retrieves a MobX-reactive observable proxy around a LiveDocument.
 *
 * Property reads observe changes through the document's internal MobX atom.
 * Property writes trigger asynchronous .patch() operations.
 *
 * @param doc Target LiveDocument instance
 * @returns Observable document proxy
 */
export function toObservableDocument<T extends object>(
    doc: LiveDocument<T>
): ObservableLiveDocument<T> {
    const existing = proxyCache.get(doc);
    if (existing) {
        return existing as ObservableLiveDocument<T>;
    }

    const proxy = new Proxy(doc, {
        get(target, prop, receiver) {
            // Direct LiveDocument interface properties and symbols
            if (prop in target || typeof prop === 'symbol') {
                const val = Reflect.get(target, prop, receiver);
                if (typeof val === 'function') {
                    return val.bind(target);
                }
                return val;
            }

            // Fallback to reactive document data snapshot
            const data = target.data;
            if (typeof prop === 'string' && prop in data) {
                return (data as any)[prop];
            }

            return undefined;
        },

        set(target, prop, value) {
            if (typeof prop === 'string' && !(prop in target)) {
                // Property mutation triggers document patch asynchronously
                target.patch({ [prop]: value } as any).catch(() => {
                    // Deferred errors are routed to target.errors$
                });
                return true;
            }
            return Reflect.set(target, prop, value);
        },

        has(target, prop) {
            if (prop in target) {
                return true;
            }
            return prop in target.data;
        },

        ownKeys(target) {
            const dataKeys = Object.keys(target.data);
            const docKeys = Object.keys(target);
            return Array.from(new Set([...docKeys, ...dataKeys]));
        },

        getOwnPropertyDescriptor(target, prop) {
            if (prop in target) {
                return Reflect.getOwnPropertyDescriptor(target, prop);
            }
            if (typeof prop === 'string' && prop in target.data) {
                return {
                    configurable: true,
                    enumerable: true,
                    writable: true,
                    value: (target.data as any)[prop],
                };
            }
            return undefined;
        },
    }) as ObservableLiveDocument<T>;

    proxyCache.set(doc, proxy);
    return proxy;
}
