import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractPuterText,
  selectPuterModelFromList,
} from '../src/app/puterGlm.js';

test('selectPuterModelFromList keeps a requested available model', () => {
  const selected = selectPuterModelFromList([
    { id: 'gemini-2.5-flash-lite' },
    { id: 'claude-sonnet-4-5' },
  ], 'claude-sonnet-4-5');

  assert.equal(selected, 'claude-sonnet-4-5');
});

test('selectPuterModelFromList prefers lightweight documented models', () => {
  const selected = selectPuterModelFromList([
    { id: 'claude-sonnet-4-5' },
    { id: 'gemini-2.5-flash-lite' },
    { id: 'openai/gpt-5.2-chat' },
  ]);

  assert.equal(selected, 'gemini-2.5-flash-lite');
});

test('extractPuterText supports common Puter response shapes', () => {
  assert.equal(extractPuterText('plain'), 'plain');
  assert.equal(extractPuterText({ text: 'chunk' }), 'chunk');
  assert.equal(extractPuterText({ message: { content: 'message' } }), 'message');
  assert.equal(extractPuterText({ message: { content: [{ text: 'hello ' }, { content: 'world' }] } }), 'hello world');
  assert.equal(extractPuterText({ output: [{ content: [{ text: 'output' }] }] }), 'output');
  assert.equal(extractPuterText({ toString: () => 'stringified' }), 'stringified');
});
