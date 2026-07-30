/**
 * Backward-compatible notify import surface.
 *
 * Fund NAV retrieval is a shared data-domain service used by notify and
 * ocr-proxy; keep this path as a compatibility re-export for existing notify
 * modules while the implementation lives outside either Worker.
 */
export * from '../../shared/src/fundNavService.js';
