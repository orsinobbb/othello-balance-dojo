import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, bitsToSquares, legalMoves, popcount } from '../src/core/bitboard.js';

const bits = (...squares) => squares.reduce((value, square) => value | (1n << BigInt(square)), 0n);

test('standard opening has four legal black moves', () => {
  const position = { player:bits(35, 28), opponent:bits(27, 36) };
  assert.deepEqual(bitsToSquares(legalMoves(position)), [19, 26, 37, 44]);
  const child = applyMove(position, 19);
  assert.equal(popcount(child.opponent), 4);
  assert.equal(popcount(child.player), 1);
});
