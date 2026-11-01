/**
 * RFC 7396 JSON Merge Patch implementation.
 * Ensures deterministic, atomic document patching with structural sharing.
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
 * Applies an RFC 7396 JSON Merge Patch to a target object with structural sharing.
 *
 * @param target Original target document
 * @param patch Patch object containing delta updates or nulls for deletion
 * @returns Resulting document after merge patch application
 */
export function jsonMergePatch<T = Record<string, unknown>>(target: unknown, patch: unknown): T {
    if (!isPlainObject(patch)) {
        return deepClone(patch) as T;
    }

    const result: Record<string, unknown> = isPlainObject(target) ? { ...target } : {};

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

/**
 * Merges two RFC 7396 merge patches together into a single combined patch with structural sharing.
 * Preserves null values representing key deletions.
 */
export function mergePatches(
    basePatch: Record<string, unknown>,
    newPatch: Record<string, unknown>
): Record<string, unknown> {
    const result: Record<string, unknown> = isPlainObject(basePatch) ? { ...basePatch } : {};

    for (const [key, value] of Object.entries(newPatch)) {
        if (value === null) {
            result[key] = null;
        } else if (isPlainObject(value)) {
            const prev = isPlainObject(result[key]) ? (result[key] as Record<string, unknown>) : {};
            result[key] = mergePatches(prev, value);
        } else {
            result[key] = deepClone(value);
        }
    }

    return result;
}
