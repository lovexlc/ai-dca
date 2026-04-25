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
      // 实际组件库中有大量不报错的 unused-vars，这里临时只在未使用的 import 上提醒
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }]
    }
  }
];
