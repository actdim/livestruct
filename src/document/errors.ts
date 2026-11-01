/**
 * @actdim/livestruct - Errors and Async Helpers
 * Custom value errors and safe unhandled rejection suppression helpers.
 */

export class LiveStructValueError extends Error {
    readonly path?: string;

    constructor(message: string, path?: string) {
        super(message);
        this.name = 'LiveStructValueError';
        this.path = path;
        Object.setPrototypeOf(this, LiveStructValueError.prototype);
    }
}

export type ErrorSink =
    | { next(err: Error): void }
    | ((err: Error) => void)
    | undefined;

/**
 * Wraps a Promise to prevent unhandled rejections and optionally route errors
 * to an observable Subject or error sink.
 */
export function reportAsync<T>(
    promise: Promise<T> | undefined | null,
    context: string,
    errors$?: ErrorSink
): Promise<T | undefined> {
    if (!promise || typeof (promise as any).then !== 'function') {
        return Promise.resolve(undefined);
    }
    return promise.catch((rawErr: unknown) => {
        const err = rawErr instanceof Error ? rawErr : new Error(`[${context}] ${String(rawErr)}`);
        if (errors$) {
            if (typeof errors$ === 'function') {
                errors$(err);
            } else if (typeof errors$.next === 'function') {
                errors$.next(err);
            }
        }
        return undefined;
    });
}
