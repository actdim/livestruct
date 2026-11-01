/**
 * @actdim/livestruct - Patch Helper
 * Constructs RFC 7396 compatible patch payloads, SQLite json_set paths,
 * JSON validation, and set-semantic nested property updates.
 */

import { setNestedPath, type NestedPath, type PathValue } from '../lens/index';
import { LiveStructValueError } from './errors';

/**
 * Validates that a value contains only JSON-serializable primitives, plain objects, and arrays.
 * Rejects Date, TypedArray, ArrayBuffer, Map, Set, Function, Symbol, BigInt, and class instances.
 */
export function assertJsonSafe(value: unknown, path = '', seen = new Set<unknown>()): void {
    if (value === null || value === undefined) {
        return;
    }

    const type = typeof value;
    if (type === 'string' || type === 'boolean') {
        return;
    }

    if (type === 'number') {
        if (!Number.isFinite(value)) {
            throw new LiveStructValueError(
                `Non-finite number at ${path || 'root'}: NaN and Infinity are not JSON-safe`,
                path
            );
        }
        return;
    }

    if (type === 'function') {
        throw new LiveStructValueError(
            `Function at ${path || 'root'}: functions are not serializable`,
            path
        );
    }

    if (type === 'symbol') {
        throw new LiveStructValueError(
            `Symbol at ${path || 'root'}: symbols are not serializable`,
            path
        );
    }

    if (type === 'bigint') {
        throw new LiveStructValueError(
            `BigInt at ${path || 'root'}: bigints are not serializable`,
            path
        );
    }

    if (type === 'object') {
        if (value instanceof Date) {
            throw new LiveStructValueError(
                `Date at ${path || 'root'}: convert to ISO string or number`,
                path
            );
        }

        if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
            throw new LiveStructValueError(
                `TypedArray / ArrayBuffer at ${path || 'root'}: use BlobStore for binary payloads`,
                path
            );
        }

        if (value instanceof Map) {
            throw new LiveStructValueError(
                `Map at ${path || 'root'}: convert to plain object`,
                path
            );
        }

        if (value instanceof Set) {
            throw new LiveStructValueError(
                `Set at ${path || 'root'}: convert to array`,
                path
            );
        }

        if (seen.has(value)) {
            throw new LiveStructValueError(
                `Circular reference at ${path || 'root'}`,
                path
            );
        }
        seen.add(value);

        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                assertJsonSafe(value[i], path ? `${path}.${i}` : `${i}`, seen);
            }
            seen.delete(value);
            return;
        }

        const proto = Object.getPrototypeOf(value);
        if (proto !== null && proto !== Object.prototype) {
            const className = proto.constructor?.name || 'Custom';
            throw new LiveStructValueError(
                `Class instance '${className}' at ${path || 'root'}: only plain objects and arrays are serializable`,
                path
            );
        }

        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            assertJsonSafe(val, path ? `${path}.${key}` : key, seen);
        }
        seen.delete(value);
    }
}

/**
 * Converts a dot-separated property path (with optional array indices) to a SQLite json_set path.
 * Examples:
 *   "profile.address" -> "$.profile.address"
 *   "items.0.title"   -> "$.items[0].title"
 */
export function toSqliteJsonPath(path: string): string {
    if (!path || path === '$') {
        return '$';
    }
    const cleanPath = path.startsWith('$.') ? path.slice(2) : path.startsWith('$') ? path.slice(1) : path;
    const segments = cleanPath.split('.');
    let result = '$';
    for (const segment of segments) {
        if (/^\d+$/.test(segment)) {
            result += `[${segment}]`;
        } else {
            result += `.${segment}`;
        }
    }
    return result;
}

/**
 * Immutably updates a target object at path with SET semantics on a structural clone.
 * Replaces the target subtree without deep merging.
 */
export function setAtPath<T extends object>(target: T, path: string, value: any): T {
    if (!path) {
        return value;
    }
    const clone = structuredClone(target);
    return setNestedPath(clone, path as any, value);
}

/**
 * Builds a patch payload from a dot-separated nested path and value.
 */
export function buildPathPatch<T extends object, P extends NestedPath<T>>(
    target: T,
    path: P,
    value: PathValue<T, P>
): Record<string, unknown> {
    const strPath = String(path);
    if (!strPath) {
        return {};
    }

    const segments = strPath.split('.');
    if (segments.length === 1) {
        return { [segments[0]]: value };
    }

    const hasArrayIndex = segments.some((s) => /^\d+$/.test(s));
    if (!hasArrayIndex) {
        let current: any = value;
        for (let i = segments.length - 1; i >= 0; i--) {
            current = { [segments[i]]: current };
        }
        return current;
    }

    const updated = setNestedPath(target, path, value);
    const rootKey = segments[0];
    return { [rootKey]: (updated as any)[rootKey] };
}
