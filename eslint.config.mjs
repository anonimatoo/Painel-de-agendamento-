import tsParser from '@typescript-eslint/parser'

export default [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      'no-debugger': 'error',
      'no-dupe-else-if': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'no-constant-binary-expression': 'error'
    }
  }
]
