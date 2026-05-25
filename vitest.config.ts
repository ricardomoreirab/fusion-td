import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Pure-logic tests only — Babylon scene code requires WebGL and is
        // excluded from this harness. The included files all avoid touching
        // `@babylonjs/core` at module load.
        include: ['tests/**/*.spec.ts'],
        environment: 'node',
        globals: false,
        // No setup files needed — we hand-construct units under test.
        reporters: 'default',
    },
});
