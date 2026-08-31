/**
 * Moved to src/shared/trainer.ts (2026-08-31) so the main process (tsconfig.node) can import the
 * same definitions the renderer uses instead of maintaining a drifted duplicate. This re-export
 * keeps every existing `../types/trainer` / `./types/trainer` import working unchanged.
 */
export * from '../../../shared/trainer'
