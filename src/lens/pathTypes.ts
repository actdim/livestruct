/**
 * @actdim/livestruct - Lens Path Types
 * Compile-time type-checked property path resolution with recursion depth guards.
 */

export type Primitive = string | number | boolean | bigint | symbol | null | undefined;

export type LeafTypes =
    | Primitive
    | Function
    | Date
    | RegExp
    | Uint8Array
    | Float32Array
    | Int8Array
    | Uint16Array
    | Int16Array
    | Uint32Array
    | Int32Array
    | Float64Array
    | BigInt64Array
    | BigUint64Array
    | ArrayBuffer
    | SharedArrayBuffer
    | DataView
    | Blob
    | Map<unknown, unknown>
    | Set<unknown>
    | WeakMap<object, unknown>
    | WeakSet<object>
    | Promise<unknown>;

type IsAny<T> = 0 extends 1 & T ? true : false;

export type IsLeaf<T> = IsAny<T> extends true
    ? true
    : [T] extends [LeafTypes]
      ? true
      : false;

export type DepthCounter = readonly unknown[];

/**
 * Default maximum recursion depth (level 4-5) to prevent compiler stalls.
 * Represents a tuple of length 4.
 */
export type DefaultMaxDepth = 4;

type NextDepth<D extends DepthCounter> = [...D, unknown];

type ObjectKeys<T> = T extends readonly unknown[]
    ? number extends T['length']
        ? `${number}`
        : Extract<keyof T, `${number}`>
    : Extract<keyof T, string>;

type ValueAtKey<T, K extends string> = T extends readonly (infer Element)[]
    ? Element
    : K extends keyof T
      ? T[K]
      : never;

/**
 * Generate all dot-separated nested property paths for type T up to max recursion depth.
 */
export type NestedPath<T, Depth extends DepthCounter = []> = IsAny<T> extends true
    ? string
    : Depth['length'] extends DefaultMaxDepth
      ? never
      : NonNullable<T> extends infer NonNullT
        ? IsLeaf<NonNullT> extends true
            ? never
            : {
                  [K in ObjectKeys<NonNullT>]: K extends string
                      ? ValueAtKey<NonNullT, K> extends infer Val
                          ? IsLeaf<NonNullable<Val>> extends true
                              ? K
                              : K | `${K}.${NestedPath<NonNullable<Val>, NextDepth<Depth>>}`
                          : never
                      : never;
              }[ObjectKeys<NonNullT>]
        : never;

/**
 * Resolve the value type at dot-separated path P on type T.
 */
export type PathValue<T, P extends string> = IsAny<T> extends true
    ? any
    : P extends `${infer Key}.${infer Rest}`
      ? Key extends keyof NonNullable<T>
          ? PathValue<NonNullable<T>[Key], Rest>
          : Key extends `${number}`
            ? NonNullable<T> extends readonly (infer Element)[]
                ? PathValue<Element, Rest>
                : undefined
            : undefined
      : P extends keyof NonNullable<T>
        ? NonNullable<T>[P]
        : P extends `${number}`
          ? NonNullable<T> extends readonly (infer Element)[]
              ? Element
              : undefined
          : undefined;
