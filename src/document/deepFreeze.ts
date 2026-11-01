/**
 * @actdim/livestruct - Deep Freeze Helper
 * Deeply freezes objects and arrays to prevent internal state mutation.
 */

export function deepFreeze<T>(obj: T): Readonly<T> {
    if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) {
        return obj as Readonly<T>;
    }
    Object.freeze(obj);
    for (const key of Object.getOwnPropertyNames(obj)) {
        const val = (obj as Record<string, unknown>)[key];
        if (
            val !== null &&
            (typeof val === 'object' || typeof val === 'function') &&
            !Object.isFrozen(val)
        ) {
            deepFreeze(val);
        }
    }
    return obj as Readonly<T>;
}
