export const PASS_MOVE = 64;
export const MASK64 = (1n << 64n) - 1n;
const FILE_A = 0x0101010101010101n;
const FILE_H = 0x8080808080808080n;
const DIRECTIONS = ['E', 'W', 'S', 'N', 'SE', 'SW', 'NE', 'NW'];

function shift(bits, direction) {
  switch (direction) {
    case 'E': return ((bits & (MASK64 ^ FILE_H)) << 1n) & MASK64;
    case 'W': return (bits & (MASK64 ^ FILE_A)) >> 1n;
    case 'S': return (bits << 8n) & MASK64;
    case 'N': return bits >> 8n;
    case 'SE': return ((bits & (MASK64 ^ FILE_H)) << 9n) & MASK64;
    case 'SW': return ((bits & (MASK64 ^ FILE_A)) << 7n) & MASK64;
    case 'NE': return (bits & (MASK64 ^ FILE_H)) >> 7n;
    case 'NW': return (bits & (MASK64 ^ FILE_A)) >> 9n;
    default: throw new Error(`Unknown direction ${direction}`);
  }
}

export function legalMoves(position) {
  const empty = MASK64 ^ (position.player | position.opponent);
  let result = 0n;
  for (const direction of DIRECTIONS) {
    let ray = shift(position.player, direction) & position.opponent;
    for (let distance = 0; distance < 5; distance += 1) {
      ray |= shift(ray, direction) & position.opponent;
    }
    result |= shift(ray, direction) & empty;
  }
  return result;
}

export function flipsFor(position, square) {
  if (!Number.isInteger(square) || square < 0 || square >= 64) return 0n;
  const move = 1n << BigInt(square);
  if (((position.player | position.opponent) & move) !== 0n) return 0n;
  let allFlips = 0n;
  for (const direction of DIRECTIONS) {
    let cursor = shift(move, direction);
    let captured = 0n;
    while ((cursor & position.opponent) !== 0n) {
      captured |= cursor;
      cursor = shift(cursor, direction);
    }
    if ((cursor & position.player) !== 0n) allFlips |= captured;
  }
  return allFlips;
}

export function applyMove(position, square) {
  const flips = flipsFor(position, square);
  if (flips === 0n) throw new Error(`Illegal move ${squareName(square)}`);
  const move = 1n << BigInt(square);
  const movedPlayer = position.player | flips | move;
  const movedOpponent = position.opponent & (MASK64 ^ flips);
  return { player: movedOpponent, opponent: movedPlayer };
}

export function passTurn(position) {
  return { player: position.opponent, opponent: position.player };
}

export function bitsToSquares(bits) {
  const result = [];
  for (let square = 0; square < 64; square += 1) {
    if ((bits & (1n << BigInt(square))) !== 0n) result.push(square);
  }
  return result;
}

export function popcount(bits) {
  let count = 0;
  let value = bits & MASK64;
  while (value !== 0n) {
    value &= value - 1n;
    count += 1;
  }
  return count;
}

export function emptyCount(position) {
  return 64 - popcount(position.player | position.opponent);
}

export function squareName(square) {
  if (square === PASS_MOVE) return 'PASS';
  if (!Number.isInteger(square) || square < 0 || square >= 64) return '?';
  return `${String.fromCharCode(65 + (square % 8))}${1 + Math.floor(square / 8)}`;
}

export function hex64(value) {
  return value.toString(16).padStart(16, '0');
}

export function positionKey(position) {
  return `${hex64(position.player)}${hex64(position.opponent)}`;
}

export function samePosition(left, right) {
  return left.player === right.player && left.opponent === right.opponent;
}
