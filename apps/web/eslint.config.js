import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.next/**', 'next-env.d.ts', 'dist/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser
      }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  }
);
