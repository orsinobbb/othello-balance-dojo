import { MASK64 } from './bitboard.js';

export function transformSquare(square, symmetry) {
  const row = Math.floor(square / 8);
  const column = square % 8;
  switch (symmetry) {
    case 0: return row * 8 + column;
    case 1: return column * 8 + (7 - row);
    case 2: return (7 - row) * 8 + (7 - column);
    case 3: return (7 - column) * 8 + row;
    case 4: return row * 8 + (7 - column);
    case 5: return (7 - row) * 8 + column;
    case 6: return column * 8 + row;
    case 7: return (7 - column) * 8 + (7 - row);
    default: throw new Error(`Invalid symmetry ${symmetry}`);
  }
}

export function transformBits(bits, symmetry) {
  let transformed = 0n;
  for (let square = 0; square < 64; square += 1) {
    if ((bits & (1n << BigInt(square))) !== 0n) {
      transformed |= 1n << BigInt(transformSquare(square, symmetry));
    }
  }
  return transformed & MASK64;
}

export function transformPosition(position, symmetry) {
  return {
    player: transformBits(position.player, symmetry),
    opponent: transformBits(position.opponent, symmetry)
  };
}

export function canonicalize(position) {
  let best = { position, symmetry: 0 };
  for (let symmetry = 1; symmetry < 8; symmetry += 1) {
    const candidate = transformPosition(position, symmetry);
    if (candidate.player < best.position.player ||
        (candidate.player === best.position.player && candidate.opponent < best.position.opponent)) {
      best = { position: candidate, symmetry };
    }
  }
  return best;
}

export function inverseSymmetry(symmetry) {
  return [0, 3, 2, 1, 4, 5, 6, 7][symmetry];
}

export function composeSymmetry(outer, inner) {
  for (let candidate = 0; candidate < 8; candidate += 1) {
    let matches = true;
    for (let square = 0; square < 64; square += 1) {
      const expected = transformSquare(transformSquare(square, inner), outer);
      if (transformSquare(square, candidate) !== expected) {
        matches = false;
        break;
      }
    }
    if (matches) return candidate;
  }
  throw new Error(`Cannot compose symmetries ${outer}/${inner}`);
}

export function canonicalToDisplayAfterChild(currentDisplaySymmetry, childCanonicalSymmetry) {
  return composeSymmetry(currentDisplaySymmetry, inverseSymmetry(childCanonicalSymmetry));
}
