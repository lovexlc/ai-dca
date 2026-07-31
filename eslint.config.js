import js from '@eslint/js';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'docs/**',
      'frontend-dist/**',
      '.frontend-build/**',
      'data/**',
      'scripts/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: { ...globals.browser, ...globals.node }
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks
    },
    settings: {
      react: { version: 'detect' }
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      // 保持未使用变量为硬错误，避免新的死代码被既有告警淹没。
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }]
    }
  }
];
