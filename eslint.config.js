import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
  },
  {
    // Node worker harness files (.mjs): Node host APIs are not ECMAScript
    // built-ins, so no-undef needs the explicit globals here.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        setImmediate: 'readonly',
        Buffer: 'readonly',
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  eslintConfigPrettier,
);
