/**
 * @actdim/livestruct - Patch Helper
 * Constructs RFC 7396 compatible patch payloads from nested property paths.
 */

import { setNestedPath, type NestedPath, type PathValue } from '../lens/index';

/**
 * Builds an RFC 7396 compatible patch payload from a dot-separated nested path and value.
 *
 * For pure object properties (e.g. 'profile.name'), produces nested objects { profile: { name: value } }.
 * For paths containing array indices (e.g. 'items.0.name'), leverages setNestedPath to produce
 * the updated root property matching RFC 7396 array replacement rules.
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
