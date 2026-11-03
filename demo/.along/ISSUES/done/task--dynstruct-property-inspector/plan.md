# Plan: Dynstruct Reactive Property Inspector Form

Execution Mode: Direct

## Steps
1. Create `src/components/PropertyInspector.tsx`:
   - Wrapped with `observer` from `mobx-react-lite` reading `cadStore.doc.data`.
   - Shape selector dropdown allowing selection of any shape or none.
   - For selected shape, render:
     - Name input: local buffered state with 200ms debounce commit to `cadStore.doc.patch` to avoid cursor jumping.
     - Layer dropdown: immediate `cadStore.doc.patch` commit on change.
     - Fill color picker: immediate `cadStore.doc.patch` commit on change.
     - Stroke color picker: immediate `cadStore.doc.patch` commit on change.
     - Stroke width slider / number input: immediate `cadStore.doc.patch` commit.
     - Position & size inputs: X, Y, width/height (for rect), radius (for circle), x2/y2 (for line).
     - Rotation slider (0 - 360).
     - Deselect button.
   - Empty state when no shape is selected.
2. Mount `<PropertyInspector cadStore={store} />` in `src/App.tsx`.
3. Create `tests/propertyInspector.test.ts`:
   - REQ-1: Verify MobX reactivity and observer rendering.
   - REQ-2: Verify optimistic patch commits for name, layer, fill, stroke, strokeWidth.
   - REQ-3: Verify synchronous updates when canvas or external LiveDocument.$ emits.
   - Verify debounced text commit prevents premature writes and value reversions.
4. Format with Prettier, verify ASCII cleanliness.
5. Run vitest and build: `pnpm --dir src --filter @actdim/livestruct-demo test` and `pnpm --dir src --filter @actdim/livestruct-demo build`.
6. Commit changes to git and mark issue done via `along issue done dynstruct-property-inspector`.
