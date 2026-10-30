/**
 * @actdim/livestruct - Lens Runtime Operations
 * Functional lenses for safe nested property access, inspection, and immutable updates.
 */

import type { NestedPath, PathValue } from './pathTypes';

/**
 * Safely resolves a nested value at the given path without throwing on undefined or null segments.
 *
 * @param obj Target object to traverse
 * @param path Dot-separated property path
 * @returns Resolved value at path or undefined
 */
export function getNestedPath<T, P extends NestedPath<T>>(obj: T, path: P): PathValue<T, P> | undefined {
    if (obj === null || obj === undefined || typeof path !== 'string' || path === '') {
        return undefined;
    }
    const segments = path.split('.');
    let current: any = obj;
    for (const segment of segments) {
        if (current === null || current === undefined) {
            return undefined;
        }
        current = current[segment];
    }
    return current as PathValue<T, P>;
}

/**
 * Safely checks if a dot-separated nested path exists in the target object.
 *
 * @param obj Target object to inspect
 * @param path Dot-separated property path
 * @returns True if path exists in target, false otherwise
 */
export function hasNestedPath<T>(obj: T, path: string): boolean {
    if (obj === null || obj === undefined || typeof path !== 'string' || path === '') {
        return false;
    }
    const segments = path.split('.');
    let current: any = obj;
    for (let i = 0; i < segments.length; i++) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return false;
        }
        const segment = segments[i];
        if (Array.isArray(current)) {
            const idx = Number(segment);
            if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
                return false;
            }
            current = current[idx];
        } else {
            if (!Object.prototype.hasOwnProperty.call(current, segment)) {
                return false;
            }
            current = current[segment];
        }
    }
    return true;
}

function setIn(target: any, segments: string[], value: any): any {
    if (segments.length === 0) {
        return value;
    }
    const [head, ...tail] = segments;

    if (Array.isArray(target)) {
        const container = [...target];
        const idx = Number(head);
        if (tail.length === 0) {
            container[idx] = value;
        } else {
            const nextTarget = container[idx];
            container[idx] = setIn(
                nextTarget !== null && typeof nextTarget === 'object'
                    ? nextTarget
                    : /^\d+$/.test(tail[0])
                      ? []
                      : {},
                tail,
                value
            );
        }
        return container;
    } else if (target !== null && typeof target === 'object') {
        const container = { ...target };
        if (tail.length === 0) {
            container[head] = value;
        } else {
            const nextTarget = container[head];
            container[head] = setIn(
                nextTarget !== null && typeof nextTarget === 'object'
                    ? nextTarget
                    : /^\d+$/.test(tail[0])
                      ? []
                      : {},
                tail,
                value
            );
        }
        return container;
    } else {
        const isArray = /^\d+$/.test(head);
        const container: any = isArray ? [] : {};
        if (tail.length === 0) {
            container[head] = value;
        } else {
            container[head] = setIn(/^\d+$/.test(tail[0]) ? [] : {}, tail, value);
        }
        return container;
    }
}

/**
 * Returns a new cloned object with the updated nested property at path.
 * Creates intermediate objects or arrays if necessary without mutating the original object.
 *
 * @param obj Target object to update
 * @param path Dot-separated property path
 * @param value New value to set at path
 * @returns Cloned object with updated value
 */
export function setNestedPath<T, P extends NestedPath<T>>(obj: T, path: P, value: PathValue<T, P>): T {
    if (typeof path !== 'string' || path === '') {
        return obj;
    }
    const segments = path.split('.');
    return setIn(obj, segments, value) as T;
}

function deleteIn(target: any, segments: string[]): any {
    if (target === null || target === undefined || typeof target !== 'object' || segments.length === 0) {
        return target;
    }
    const [head, ...tail] = segments;

    if (Array.isArray(target)) {
        const container = [...target];
        const idx = Number(head);
        if (tail.length === 0) {
            if (Number.isInteger(idx) && idx >= 0 && idx < container.length) {
                container.splice(idx, 1);
            }
            return container;
        }
        if (idx >= 0 && idx < container.length) {
            container[idx] = deleteIn(container[idx], tail);
        }
        return container;
    } else {
        const container = { ...target };
        if (tail.length === 0) {
            delete container[head];
            return container;
        }
        if (head in container) {
            container[head] = deleteIn(container[head], tail);
        }
        return container;
    }
}

/**
 * Returns a new cloned object with the specified property removed at path.
 * Preserves the original object immutably.
 *
 * @param obj Target object
 * @param path Dot-separated property path to delete
 * @returns Cloned object without deleted property
 */
export function deleteNestedPath<T, P extends NestedPath<T>>(obj: T, path: P): T {
    if (typeof path !== 'string' || path === '') {
        return obj;
    }
    const segments = path.split('.');
    return deleteIn(obj, segments) as T;
}
