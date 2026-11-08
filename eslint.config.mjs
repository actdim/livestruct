import { defineConfig } from 'eslint/config';
import { legacyRoot } from '@actdim/dev-config/eslint/legacy';

// Same rule set as the livestruct block of the mempart root config (legacy profile + no-explicit-any),
// so `pnpm lint` also works in a standalone clone.
export default defineConfig([
    ...legacyRoot({ tsconfigRootDir: import.meta.dirname }),
    {
        files: ['src/**/*.{ts,tsx}'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
        },
    },
]);
