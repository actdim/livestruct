/**
 * RFC 7396 JSON Merge Patch implementation.
 * Ensures deterministic, atomic document patching.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') {
        return false;
    }
    if (Array.isArray(value)) {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function deepClone<T>(val: T): T {
    if (val === null || typeof val !== 'object') {
        return val;
    }
    if (Array.isArray(val)) {
        return val.map((item) => deepClone(item)) as unknown as T;
    }
    if (val instanceof Uint8Array) {
        return new Uint8Array(val) as unknown as T;
    }
    if (val instanceof Float32Array) {
        return new Float32Array(val) as unknown as T;
    }
    const cloned: Record<string, unknown> = {};
    for (const key of Object.keys(val as Record<string, unknown>)) {
        cloned[key] = deepClone((val as Record<string, unknown>)[key]);
    }
    return cloned as T;
}

/**
 * Applies an RFC 7396 JSON Merge Patch to a target object.
 *
 * @param target Original target document
 * @param patch Patch object containing delta updates or nulls for deletion
 * @returns Resulting document after merge patch application
 */
export function jsonMergePatch<T = Record<string, unknown>>(target: unknown, patch: unknown): T {
    if (!isPlainObject(patch)) {
        return deepClone(patch) as T;
    }

    const result: Record<string, unknown> = isPlainObject(target) ? deepClone(target) : {};

    for (const [key, value] of Object.entries(patch)) {
        if (value === null) {
            delete result[key];
        } else if (isPlainObject(value)) {
            result[key] = jsonMergePatch(result[key], value);
        } else {
            result[key] = deepClone(value);
        }
    }

    return result as T;
}
