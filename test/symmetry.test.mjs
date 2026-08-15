import test from 'node:test';
import assert from 'node:assert/strict';
import { composeSymmetry, inverseSymmetry, transformSquare } from '../src/core/symmetry.js';

test('all board symmetries round-trip and compose', () => {
  for (let symmetry = 0; symmetry < 8; symmetry += 1) {
    const inverse = inverseSymmetry(symmetry);
    assert.equal(composeSymmetry(inverse, symmetry), 0);
    for (let square = 0; square < 64; square += 1) {
      assert.equal(transformSquare(transformSquare(square, symmetry), inverse), square);
    }
  }
});
