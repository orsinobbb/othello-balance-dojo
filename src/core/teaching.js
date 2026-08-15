import {
  MASK64,
  applyMove,
  bitsToSquares,
  flipsFor,
  legalMoves,
  passTurn,
  popcount,
  squareName
} from './bitboard.js';
import { NativeEdgeOutcome } from '../data/native-balanced-dag.js';

const CORNERS = new Set([0, 7, 56, 63]);
const X_SQUARES = new Set([9, 14, 49, 54]);
const C_SQUARES = new Set([1, 8, 6, 15, 48, 57, 55, 62]);

function neighbors(square) {
  const row = Math.floor(square / 8);
  const column = square % 8;
  const result = [];
  if (row > 0) result.push(square - 8);
  if (row < 7) result.push(square + 8);
  if (column > 0) result.push(square - 1);
  if (column < 7) result.push(square + 1);
  return result;
}

export function emptyRegions(position) {
  const empty = MASK64 ^ (position.player | position.opponent);
  const unseen = new Set(bitsToSquares(empty));
  const regions = [];
  const regionBySquare = new Map();

  while (unseen.size > 0) {
    const start = unseen.values().next().value;
    const queue = [start];
    const squares = [];
    unseen.delete(start);
    while (queue.length > 0) {
      const square = queue.pop();
      squares.push(square);
      for (const neighbor of neighbors(square)) {
        if (!unseen.has(neighbor)) continue;
        unseen.delete(neighbor);
        queue.push(neighbor);
      }
    }
    const region = { size: squares.length, squares };
    regions.push(region);
    for (const square of squares) regionBySquare.set(square, region);
  }

  regions.sort((left, right) => right.size - left.size || left.squares[0] - right.squares[0]);
  return { regions, regionBySquare };
}

function category(square) {
  if (CORNERS.has(square)) return '角落';
  if (X_SQUARES.has(square)) return 'X 格';
  if (C_SQUARES.has(square)) return 'C 格';
  const row = Math.floor(square / 8);
  const column = square % 8;
  if (row === 0 || row === 7 || column === 0 || column === 7) return '邊線';
  return '內部';
}

function exactResult(edge) {
  if (edge.outcome === NativeEdgeOutcome.BALANCED || edge.outcome === NativeEdgeOutcome.PASS) return '和局';
  if (edge.outcome === NativeEdgeOutcome.FAILURE) return '必敗';
  return '資料異常';
}

export function analyzeTurn(session) {
  const position = session.position;
  const { regions, regionBySquare } = emptyRegions(position);
  const opponentMovesNow = new Set(bitsToSquares(legalMoves(passTurn(position))));
  const facts = session.edges
    .filter((edge) => edge.move < 64)
    .map((edge) => {
      const child = applyMove(position, edge.move);
      const opponentMoves = bitsToSquares(legalMoves(child));
      const openedCorners = opponentMoves.filter((square) => CORNERS.has(square));
      const region = regionBySquare.get(edge.move);
      const displaySquare = session.displaySquare(edge.move);
      return {
        edge,
        square: edge.move,
        displaySquare,
        name: squareName(displaySquare),
        category: category(displaySquare),
        regionSize: region?.size || 0,
        flips: popcount(flipsFor(position, edge.move)),
        opponentMobility: opponentMoves.length,
        openedCorners: openedCorners.map((square) => squareName(session.displaySquare(square))),
        sharedSingleton: region?.size === 1 && opponentMovesNow.has(edge.move),
        exact: exactResult(edge),
        balanced: edge.outcome === NativeEdgeOutcome.BALANCED || edge.outcome === NativeEdgeOutcome.PASS
      };
    });

  const lowestMobility = Math.min(...facts.map((fact) => fact.opponentMobility));
  const largestRegion = regions[0]?.size || 0;
  let shortlist = facts.filter((fact) => fact.opponentMobility <= lowestMobility + 1);
  if (largestRegion >= 5) {
    const outsideLargest = shortlist.filter((fact) => fact.regionSize !== largestRegion);
    if (outsideLargest.length > 0) shortlist = outsideLargest;
  }
  shortlist.sort((left, right) =>
    Number(right.sharedSingleton) - Number(left.sharedSingleton)
    || left.opponentMobility - right.opponentMobility
    || left.flips - right.flips
    || left.displaySquare - right.displaySquare);
  shortlist = shortlist.slice(0, 4);

  return {
    color: session.turnColor === 0 ? '黑' : '白',
    empties: session.empties,
    facts,
    legalCount: facts.length,
    regions: regions.map((region) => ({
      size: region.size,
      names: region.squares
        .map((square) => session.displaySquare(square))
        .sort((left, right) => left - right)
        .map(squareName)
    })),
    largestRegion,
    lowestMobility,
    shortlist,
    sharedSingletons: facts.filter((fact) => fact.sharedSingleton),
    balanced: facts.filter((fact) => fact.balanced),
    failures: facts.filter((fact) => !fact.balanced)
  };
}

