import type { CadDocument } from './types';
import type { CadStore } from './store';

const SQLITE_MAGIC = 'SQLite format 3\0';
const DEFAULT_DOC_ID = 'doc-default';

function encodeVarint(n: number): Uint8Array {
    if (n < 0x80) {
        return new Uint8Array([n]);
    }
    if (n < 0x4000) {
        return new Uint8Array([(n >> 7) | 0x80, n & 0x7f]);
    }
    if (n < 0x200000) {
        return new Uint8Array([(n >> 14) | 0x80, ((n >> 7) & 0x7f) | 0x80, n & 0x7f]);
    }
    if (n < 0x10000000) {
        return new Uint8Array([
            (n >> 21) | 0x80,
            ((n >> 14) & 0x7f) | 0x80,
            ((n >> 7) & 0x7f) | 0x80,
            n & 0x7f,
        ]);
    }
    return new Uint8Array([
        Math.floor(n / 0x10000000) | 0x80,
        ((n >> 21) & 0x7f) | 0x80,
        ((n >> 14) & 0x7f) | 0x80,
        ((n >> 7) & 0x7f) | 0x80,
        n & 0x7f,
    ]);
}

function decodeVarint(bytes: Uint8Array, offset: number): { value: number; bytesRead: number } {
    let result = 0;
    let bytesRead = 0;
    for (let i = 0; i < 9; i++) {
        if (offset + i >= bytes.length) break;
        const b = bytes[offset + i];
        bytesRead++;
        if (i === 8) {
            result = result * 256 + b;
            break;
        }
        result = (result << 7) | (b & 0x7f);
        if ((b & 0x80) === 0) break;
    }
    return { value: result, bytesRead };
}

interface RecordField {
    type: 'text' | 'int';
    value: string | number;
}

function buildRecord(fields: RecordField[]): Uint8Array {
    const encoder = new TextEncoder();
    const typeVarints: Uint8Array[] = [];
    const bodyParts: Uint8Array[] = [];

    for (const f of fields) {
        if (f.type === 'text') {
            const bytes = encoder.encode(String(f.value));
            const serial = 2 * bytes.length + 13;
            typeVarints.push(encodeVarint(serial));
            bodyParts.push(bytes);
        } else if (f.type === 'int') {
            typeVarints.push(new Uint8Array([1]));
            bodyParts.push(new Uint8Array([Number(f.value) & 0xff]));
        }
    }

    const typesByteLength = typeVarints.reduce((sum, v) => sum + v.length, 0);
    let hdrLenVarint = encodeVarint(typesByteLength + 1);
    let fullHdrLen = hdrLenVarint.length + typesByteLength;
    if (encodeVarint(fullHdrLen).length !== hdrLenVarint.length) {
        hdrLenVarint = encodeVarint(fullHdrLen);
        fullHdrLen = hdrLenVarint.length + typesByteLength;
    }

    const totalLen = fullHdrLen + bodyParts.reduce((sum, b) => sum + b.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;

    result.set(hdrLenVarint, offset);
    offset += hdrLenVarint.length;

    for (const tv of typeVarints) {
        result.set(tv, offset);
        offset += tv.length;
    }

    for (const bp of bodyParts) {
        result.set(bp, offset);
        offset += bp.length;
    }

    return result;
}

function buildLeafCell(rowid: number, recordBytes: Uint8Array): Uint8Array {
    const payloadLenVarint = encodeVarint(recordBytes.length);
    const rowidVarint = encodeVarint(rowid);
    const cell = new Uint8Array(payloadLenVarint.length + rowidVarint.length + recordBytes.length);
    let offset = 0;
    cell.set(payloadLenVarint, offset);
    offset += payloadLenVarint.length;
    cell.set(rowidVarint, offset);
    offset += rowidVarint.length;
    cell.set(recordBytes, offset);
    return cell;
}

/**
 * Builds a valid SQLite 3 binary database file containing cad_documents table and active document.
 */
export function buildSqliteCadDatabase(doc: CadDocument): Uint8Array {
    const docId = doc.id || DEFAULT_DOC_ID;
    const title = doc.title || 'Mechanical Assembly';
    const jsonStr = JSON.stringify(doc);

    // Schema record (Page 1)
    const schemaSql = 'CREATE TABLE cad_documents (id TEXT PRIMARY KEY, title TEXT, data TEXT)';
    const rec1 = buildRecord([
        { type: 'text', value: 'table' },
        { type: 'text', value: 'cad_documents' },
        { type: 'text', value: 'cad_documents' },
        { type: 'int', value: 2 },
        { type: 'text', value: schemaSql },
    ]);
    const cell1 = buildLeafCell(1, rec1);

    // Data record (Page 2)
    const rec2 = buildRecord([
        { type: 'text', value: docId },
        { type: 'text', value: title },
        { type: 'text', value: jsonStr },
    ]);
    const cell2 = buildLeafCell(1, rec2);

    const neededCellSize = cell2.length + 32;
    const pageSize = neededCellSize > 3800 ? 65536 : 4096;

    const p1 = new Uint8Array(pageSize);
    const encoder = new TextEncoder();

    // 100 bytes SQLite database header
    p1.set(encoder.encode(SQLITE_MAGIC), 0);
    if (pageSize === 65536) {
        p1[16] = 0x00;
        p1[17] = 0x01;
    } else {
        p1[16] = (pageSize >> 8) & 0xff;
        p1[17] = pageSize & 0xff;
    }
    p1[18] = 1; // write version
    p1[19] = 1; // read version
    p1[20] = 0; // reserved
    p1[21] = 64; // max fraction
    p1[22] = 32; // min fraction
    p1[23] = 32; // leaf fraction

    // File change counter = 1
    new DataView(p1.buffer).setUint32(24, 1, false);
    // Page count = 2
    new DataView(p1.buffer).setUint32(28, 2, false);
    // Schema cookie = 1
    new DataView(p1.buffer).setUint32(40, 1, false);
    // Schema format = 4
    new DataView(p1.buffer).setUint32(44, 4, false);
    // Text encoding = UTF-8 (1)
    new DataView(p1.buffer).setUint32(56, 1, false);
    // Version valid for = 1
    new DataView(p1.buffer).setUint32(92, 1, false);
    // SQLite version = 3045000
    new DataView(p1.buffer).setUint32(96, 3045000, false);

    // Page 1 B-tree header (offset 100)
    const cell1Offset = pageSize - cell1.length;
    p1[100] = 0x0d; // leaf table btree
    p1[101] = 0;
    p1[102] = 0;
    new DataView(p1.buffer).setUint16(103, 1, false); // 1 cell
    new DataView(p1.buffer).setUint16(105, cell1Offset, false); // cell content start
    p1[107] = 0;
    new DataView(p1.buffer).setUint16(108, cell1Offset, false); // cell 1 pointer
    p1.set(cell1, cell1Offset);

    // Page 2 B-tree header (offset 0)
    const p2 = new Uint8Array(pageSize);
    const cell2Offset = pageSize - cell2.length;
    p2[0] = 0x0d;
    p2[1] = 0;
    p2[2] = 0;
    new DataView(p2.buffer).setUint16(3, 1, false); // 1 cell
    new DataView(p2.buffer).setUint16(5, cell2Offset, false); // cell content start
    p2[7] = 0;
    new DataView(p2.buffer).setUint16(8, cell2Offset, false); // cell 1 pointer
    p2.set(cell2, cell2Offset);

    const fullDb = new Uint8Array(pageSize * 2);
    fullDb.set(p1, 0);
    fullDb.set(p2, pageSize);
    return fullDb;
}

/**
 * Parses a CAD document from a binary SQLite database or LiveStruct JSON export.
 */
export function parseCadDatabase(binaryData: Uint8Array): CadDocument {
    const magic = new TextDecoder('latin1').decode(binaryData.slice(0, 16));
    const isSqlite = magic === SQLITE_MAGIC;

    if (isSqlite) {
        try {
            const is64k = binaryData[16] === 0x00 && binaryData[17] === 0x01;
            const pageSize = is64k ? 65536 : (binaryData[16] << 8) | binaryData[17];
            const p2Start = pageSize;

            const view = new DataView(
                binaryData.buffer,
                binaryData.byteOffset,
                binaryData.byteLength
            );
            const cellOffset = view.getUint16(p2Start + 8, false);
            const cellAbs = p2Start + cellOffset;

            const payloadVarint = decodeVarint(binaryData, cellAbs);
            const rowidVarint = decodeVarint(binaryData, cellAbs + payloadVarint.bytesRead);

            const recordStart = cellAbs + payloadVarint.bytesRead + rowidVarint.bytesRead;
            const hdrLenVarint = decodeVarint(binaryData, recordStart);

            let typeCursor = recordStart + hdrLenVarint.bytesRead;
            const types: number[] = [];
            while (typeCursor < recordStart + hdrLenVarint.value) {
                const tv = decodeVarint(binaryData, typeCursor);
                types.push(tv.value);
                typeCursor += tv.bytesRead;
            }

            let bodyCursor = recordStart + hdrLenVarint.value;
            const colValues: string[] = [];

            for (const t of types) {
                if (t >= 13 && t % 2 === 1) {
                    const strLen = (t - 13) / 2;
                    const strBytes = binaryData.slice(bodyCursor, bodyCursor + strLen);
                    colValues.push(new TextDecoder('utf-8').decode(strBytes));
                    bodyCursor += strLen;
                } else if (t === 1) {
                    colValues.push(String(binaryData[bodyCursor]));
                    bodyCursor += 1;
                }
            }

            // col 2 is data JSON
            if (colValues.length >= 3 && colValues[2]) {
                const parsed = JSON.parse(colValues[2]);
                if (parsed && typeof parsed === 'object') {
                    return parsed as CadDocument;
                }
            }
        } catch {
            // Fall through to regex extraction fallback
        }

        // Robust fallback: search for JSON object containing "shapes" in binary
        const text = new TextDecoder('utf-8', { fatal: false }).decode(binaryData);
        const match = text.match(/\{"id":\s*"[^"]*",[\s\S]*?"shapes":[\s\S]*?\}(?=[^\w"]|$)/);
        if (match) {
            try {
                return JSON.parse(match[0]) as CadDocument;
            } catch {
                // Ignore
            }
        }
    }

    // JSON or OPFS document payload
    const text = new TextDecoder('utf-8').decode(binaryData);
    const parsed = JSON.parse(text);

    if (parsed && typeof parsed === 'object') {
        if (parsed.documents && typeof parsed.documents === 'object') {
            const key = `cad_documents:${DEFAULT_DOC_ID}`;
            if (parsed.documents[key]?.data) {
                return parsed.documents[key].data as CadDocument;
            }
            const first = Object.values(parsed.documents)[0] as { data?: CadDocument };
            if (first?.data) {
                return first.data;
            }
        }
        if (parsed.shapes) {
            return parsed as CadDocument;
        }
    }

    throw new Error('Unsupported or corrupted CAD project format.');
}

/**
 * REQ-5: Exports active project SQLite database directly as binary data.
 */
export async function exportCadDatabase(store: CadStore): Promise<Uint8Array> {
    const doc = store.doc.data;
    const sqliteBytes = buildSqliteCadDatabase(doc);
    return sqliteBytes;
}

/**
 * REQ-5: Downloads the active project as a binary .cad SQLite file.
 */
export async function downloadCadProject(store: CadStore, filename = 'project.cad'): Promise<void> {
    const data = await exportCadDatabase(store);
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([data as unknown as BlobPart], { type: 'application/x-sqlite3' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
}

/**
 * REQ-6: Imports binary project data (.cad SQLite or JSON) and mounts into active session.
 */
export async function importCadDatabase(store: CadStore, binaryData: Uint8Array): Promise<void> {
    const importedDoc = parseCadDatabase(binaryData);

    const patchPayload: Record<string, unknown> = {
        title: importedDoc.title || store.doc.data.title,
        selectedShapeId: importedDoc.selectedShapeId ?? null,
        shapes: {},
    };

    const currentShapes = store.doc.data.shapes || {};
    const shapesPatch: Record<string, unknown> = {};

    // Remove shapes that are not in the imported document
    for (const key of Object.keys(currentShapes)) {
        if (!importedDoc.shapes || !(key in importedDoc.shapes)) {
            shapesPatch[key] = null;
        }
    }

    // Add / update shapes from imported document
    for (const [key, shape] of Object.entries(importedDoc.shapes || {})) {
        shapesPatch[key] = shape;
    }

    patchPayload.shapes = shapesPatch;

    void store.doc.patch(patchPayload as Partial<CadDocument>);
    await store.doc.flush();
}
