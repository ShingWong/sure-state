# Task 3 Report: withAuth store wrapper

## Status: DONE_WITH_CONCERNS

## Files Created/Modified

### Created
- `src/auth-store.ts` — `withAuth()` store wrapper implementation
- `src/auth-store.test.ts` — Test suite for `withAuth`

### Modified
- `src/auth-types.ts` — Added optional `emit` method to `AuthAdapter` interface
- `src/auth-builtin.ts` — Exposed internal `emit` function in `createSimpleAuth` return value
- `src/index.ts` — Added exports for auth modules

## Changes Summary

### auth-store.ts (implementation)
The `withAuth()` function wraps an `EntityStore` with policy enforcement:
- Intercepts `create`, `update`, `delete` mutations
- Calls `getIdentity()` to resolve current user
- Delegates to `auth.can(identity, action, entity)` for authorization
- On denial: sets `store.error` on the underlying zustand store via `setState`, returns undefined (does NOT throw, so errors are communicated via `store.error` state)
- Emits `auth:denied` and `auth:unauthenticated` events through the auth adapter

**Key design deviation from plan:** The plan's implementation used `throw new Error(...)` for denied mutations. I chose `return undefined` instead, because the test suite expects `wrapped.create()` to resolve (not reject) on denial — it checks `result` and `store.error` rather than using try/catch. The EntityStore's internal error handler would NOT catch throws from the wrapper since `wrapped.create` replaces the store's method entirely.

### auth-store.test.ts (tests)
4 test cases:
1. ✅ `allows mutation when can() returns true` — verifies successful create
2. ✅ `denies mutation when can() returns false` — verifies `store.error` contains 'denied', result is undefined
3. ✅ `denies mutation when not authenticated` — verifies `store.error` is truthy when identity is null
4. ✅ `emits auth:denied event on denial` — verifies `auth:denied` event fires with expected payload

### Supporting changes
- Added `emit?` to `AuthAdapter` interface (optional) to support event emission from the wrapper
- Exposed `emit` in `createSimpleAuth` return value so events actually fire
- Exported all auth modules from `index.ts`

## Concerns

1. **Unable to run tests in this environment** — No bash/shell tool was available to execute `npx vitest run`. The tests and implementation were written following TDD principles (tests first, then implementation), but actual test execution and verification could not be performed. Please run:
   ```
   cd /usr/local/devel/sure-state && npx vitest run src/auth-store.test.ts
   ```
   to verify all 4 tests pass.

2. **Plan deviation for error handling** — As noted above, the mutation methods return undefined instead of throwing when denied. This is required by the test assertions. If the original plan's throwing behavior is desired, the tests would need try/catch or `.rejects` wrappers.

3. **AuthAdapter interface change** — Added `emit?` as an optional method. This is backward-compatible (existing adapters without `emit` still work via `?.`), but is a new interface contract.

4. **Commit pending** — Steps 6 (build + test) and 7 (git commit) could not be completed without shell access.

## Verification Commands

```bash
# Run the new auth-store tests
cd /usr/local/devel/sure-state && npx vitest run src/auth-store.test.ts

# Build and run all tests
npm run build && npm test

# Commit
git add -A && git commit -m "feat: withAuth store wrapper for policy enforcement"
```

## Report File
This report: `.superpowers/sdd/task-3-report.md`
