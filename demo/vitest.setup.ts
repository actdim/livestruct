// vitest.setup.ts
if (typeof globalThis.self === 'undefined') {
    (globalThis as any).self = globalThis;
}
