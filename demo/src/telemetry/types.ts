/**
 * Telemetry types and utility functions for the protocol and bus monitor.
 * Provides categorization, throughput calculation, and channel filtering.
 */

export type TelemetryCategory = 'ephemeral' | 'sqlite' | 'cdc';

export interface TelemetryEvent {
    id: string;
    timestamp: number;
    category: TelemetryCategory;
    channel: string;
    latencyUs?: number;
    sizeBytes?: number;
    updatedFields?: string[];
    rev?: number;
    origin?: string;
    payloadSummary: string;
    rawPayload?: unknown;
}

export interface TelemetryMetrics {
    messagesPerSec: number;
    diskWriteCount: number;
    totalEphemeralCount: number;
    totalSqliteCount: number;
    totalCdcCount: number;
}

/**
 * Calculates rolling throughput in messages per second.
 *
 * @param timestamps Array of event timestamps in milliseconds.
 * @param windowMs Rolling window duration in milliseconds (default: 1000ms).
 * @param now Current timestamp in milliseconds (default: Date.now()).
 * @returns Messages per second rounded to one decimal place.
 */
export function calculateThroughput(
    timestamps: number[],
    windowMs: number = 1000,
    now: number = Date.now()
): number {
    if (!timestamps || timestamps.length === 0 || windowMs <= 0) {
        return 0;
    }

    const cutoff = now - windowMs;
    let countInWindow = 0;

    for (let i = 0; i < timestamps.length; i++) {
        const t = timestamps[i];
        if (t >= cutoff && t <= now + 50) {
            countInWindow++;
        }
    }

    const seconds = windowMs / 1000;
    const rate = countInWindow / seconds;
    return Math.round(rate * 10) / 10;
}

/**
 * Filters telemetry events by channel prefix, category, or search query.
 *
 * @param events List of telemetry events.
 * @param filterQuery Filter string (e.g. "ALL", "cad.*", "sqlite.*", "cdc.", or search text).
 * @returns Filtered telemetry events.
 */
export function filterTelemetryEvents(
    events: TelemetryEvent[],
    filterQuery: string
): TelemetryEvent[] {
    const trimmed = filterQuery.trim().toLowerCase();
    if (!trimmed || trimmed === 'all' || trimmed === '*') {
        return events;
    }

    // Check if query is wildcard prefix like "cad.*" or "sqlite.*"
    const isWildcardPrefix = trimmed.endsWith('.*');
    const prefix = isWildcardPrefix
        ? trimmed.slice(0, -2)
        : trimmed.endsWith('.')
          ? trimmed.slice(0, -1)
          : null;

    return events.filter((event) => {
        const channelLower = event.channel.toLowerCase();
        const categoryLower = event.category.toLowerCase();

        // 1. Prefix matching
        if (prefix) {
            if (
                channelLower.startsWith(prefix + '.') ||
                channelLower === prefix ||
                categoryLower === prefix
            ) {
                return true;
            }
        }

        // 2. Direct category match
        if (categoryLower === trimmed) {
            return true;
        }

        // 3. Channel prefix match (e.g. "cad.")
        if (channelLower.startsWith(trimmed)) {
            return true;
        }

        // 4. Substring in channel
        if (channelLower.includes(trimmed)) {
            return true;
        }

        // 5. Substring in payloadSummary
        if (event.payloadSummary.toLowerCase().includes(trimmed)) {
            return true;
        }

        // 6. Substring in origin
        if (event.origin && event.origin.toLowerCase().includes(trimmed)) {
            return true;
        }

        // 7. Substring in updatedFields
        if (
            event.updatedFields &&
            event.updatedFields.some((field) => field.toLowerCase().includes(trimmed))
        ) {
            return true;
        }

        return false;
    });
}

/**
 * Recursively extracts leaf dot-notated property paths from a nested update delta.
 */
export function extractUpdatedFields(delta: Record<string, unknown>, prefix = ''): string[] {
    if (!delta || typeof delta !== 'object') {
        return prefix ? [prefix] : [];
    }

    const fields: string[] = [];
    const keys = Object.keys(delta);

    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const val = delta[key];
        const currentPath = prefix ? prefix + '.' + key : key;

        if (
            val !== null &&
            typeof val === 'object' &&
            !Array.isArray(val) &&
            Object.keys(val).length > 0
        ) {
            fields.push(...extractUpdatedFields(val as Record<string, unknown>, currentPath));
        } else {
            fields.push(currentPath);
        }
    }

    return fields.length > 0 ? fields : prefix ? [prefix] : [];
}

/**
 * Calculates byte size of a payload when encoded as UTF-8 JSON.
 */
export function calculatePayloadSize(payload: unknown): number {
    if (payload === undefined || payload === null) {
        return 0;
    }

    try {
        const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
        return new TextEncoder().encode(str).length;
    } catch {
        return 0;
    }
}
