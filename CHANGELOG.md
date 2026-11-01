# Changelog

All notable changes to `@actdim/livestruct` are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed
- LiveCollection instance identity deduplication under concurrent loads: concurrent calls to `collection.get(id)` return the identical `LiveDocument` instance and deduplicate in-flight queries (`bug--engine-correctness-batch`, REQ-1).
- Unhandled Promise rejections eliminated across all async paths; background timer, window event, and observable setter rejections route safely to `errors$` via `reportAsync` (`bug--engine-correctness-batch`, REQ-2).
- `patchPath` semantics updated to SET semantics (overwriting target subtree instead of RFC 7396 deep-merging object properties) and array index stability supported via `DocPathSet` in SQLite engine (`bug--engine-correctness-batch`, REQ-3).
- Full document replace via `replace(value)`: updates committed baseline without deep-merging into pending overlay, cleanly rebasing pending local mutations (`bug--engine-correctness-batch`, REQ-4).
- Deep-frozen snapshots: `doc.data`, `getDoc()`, and `queryDocs()` return deep-frozen objects; CDC deltas are cloned and frozen to prevent caller mutation aliasing (`bug--engine-correctness-batch`, REQ-5).
- Lens writes via `createDocLens` route property writes through `doc.patchPath()` instead of direct `doc.data` assignment (`bug--engine-correctness-batch`, REQ-5).
- Validation: Date, TypedArray, Map, Set, Function, Symbol, BigInt, and class instances throw descriptive `LiveStructValueError` (`bug--engine-correctness-batch`, REQ-7).

### Changed
- MobX moved from `peerDependenciesMeta.optional` to required peer dependency in `package.json` (`bug--engine-correctness-batch`, REQ-6).
- Added `subscriptionCount` getter to `LiveCollection` and `LiveDocument` for lifecycle and leak verification (`bug--engine-correctness-batch`, REQ-1).
- Added `errors$` observable stream to `LiveCollection` (`bug--engine-correctness-batch`, REQ-2).
