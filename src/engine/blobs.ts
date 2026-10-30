/**
 * Binary BLOB serialization and deserialization for CAD/GIS geometries and binary records.
 * Supports Float32Array (geometry coordinates) and Uint8Array (raw bytes).
 */

import type { BlobMap } from './types';

const MAGIC_HEADER = new Uint8Array([0x4c, 0x53, 0x42, 0x31]); // 'LSB1'
const TYPE_UINT8 = 1;
const TYPE_FLOAT32 = 2;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Serializes a dictionary of Uint8Array and Float32Array buffers into a compact binary format.
 */
export function serializeBlobs(blobs?: BlobMap | null): Uint8Array | null {
    if (!blobs || Object.keys(blobs).length === 0) {
        return null;
    }

    const entries = Object.entries(blobs);
    const encodedKeys: Array<{ keyBytes: Uint8Array; type: number; dataBytes: Uint8Array }> = [];
    let totalSize = MAGIC_HEADER.length + 4; // header + entry count

    for (const [key, value] of entries) {
        const keyBytes = textEncoder.encode(key);
        let type = TYPE_UINT8;
        let dataBytes: Uint8Array;

        if (value instanceof Float32Array) {
            type = TYPE_FLOAT32;
            dataBytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        } else if (value instanceof Uint8Array) {
            type = TYPE_UINT8;
            dataBytes = value;
        } else {
            continue;
        }

        encodedKeys.push({ keyBytes, type, dataBytes });
        totalSize += 2 + keyBytes.length + 1 + 4 + dataBytes.length;
    }

    const output = new Uint8Array(totalSize);
    output.set(MAGIC_HEADER, 0);
    const view = new DataView(output.buffer, output.byteOffset, output.byteLength);

    let offset = MAGIC_HEADER.length;
    view.setUint32(offset, encodedKeys.length, true);
    offset += 4;

    for (const entry of encodedKeys) {
        view.setUint16(offset, entry.keyBytes.length, true);
        offset += 2;

        output.set(entry.keyBytes, offset);
        offset += entry.keyBytes.length;

        view.setUint8(offset, entry.type);
        offset += 1;

        view.setUint32(offset, entry.dataBytes.length, true);
        offset += 4;

        output.set(entry.dataBytes, offset);
        offset += entry.dataBytes.length;
    }

    return output;
}

/**
 * Deserializes binary BLOBs back into a BlobMap containing Uint8Array or Float32Array.
 */
export function deserializeBlobs(buffer?: Uint8Array | null): BlobMap {
    const result: BlobMap = {};
    if (!buffer || buffer.byteLength < MAGIC_HEADER.length + 4) {
        return result;
    }

    for (let i = 0; i < MAGIC_HEADER.length; i++) {
        if (buffer[i] !== MAGIC_HEADER[i]) {
            return result;
        }
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let offset = MAGIC_HEADER.length;
    const entryCount = view.getUint32(offset, true);
    offset += 4;

    for (let i = 0; i < entryCount; i++) {
        if (offset + 2 > buffer.byteLength) {
            break;
        }
        const keyLen = view.getUint16(offset, true);
        offset += 2;

        if (offset + keyLen > buffer.byteLength) {
            break;
        }
        const keyBytes = buffer.subarray(offset, offset + keyLen);
        const key = textDecoder.decode(keyBytes);
        offset += keyLen;

        if (offset + 1 > buffer.byteLength) {
            break;
        }
        const type = view.getUint8(offset);
        offset += 1;

        if (offset + 4 > buffer.byteLength) {
            break;
        }
        const dataLen = view.getUint32(offset, true);
        offset += 4;

        if (offset + dataLen > buffer.byteLength) {
            break;
        }
        const rawSlice = buffer.subarray(offset, offset + dataLen);
        offset += dataLen;

        if (type === TYPE_FLOAT32) {
            // Ensure 4-byte alignment by creating a copy with aligned ArrayBuffer
            const alignedBuffer = new ArrayBuffer(dataLen);
            new Uint8Array(alignedBuffer).set(rawSlice);
            result[key] = new Float32Array(alignedBuffer);
        } else {
            const copy = new Uint8Array(dataLen);
            copy.set(rawSlice);
            result[key] = copy;
        }
    }

    return result;
}
