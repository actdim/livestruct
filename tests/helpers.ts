/**
 * @actdim/livestruct - Test Helpers
 * Utility functions for asynchronous stream testing without fixed sleeps.
 */

import { type Observable, firstValueFrom, filter, timeout, throwError } from 'rxjs';

/**
 * Awaits the next emission from an Observable matching the given predicate.
 * Rejects with a descriptive error if timeoutMs is exceeded.
 */
export async function nextEmission<T>(
    obs$: Observable<T>,
    predicate: (value: T) => boolean = () => true,
    timeoutMs: number = 2000
): Promise<T> {
    return firstValueFrom(
        obs$.pipe(
            filter(predicate),
            timeout({
                each: timeoutMs,
                with: () =>
                    throwError(
                        () =>
                            new Error(
                                `nextEmission timed out after ${timeoutMs}ms waiting for condition.`
                            )
                    ),
            })
        )
    );
}
