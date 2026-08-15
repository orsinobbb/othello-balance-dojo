import { applyMove, emptyCount, legalMoves, PASS_MOVE, passTurn, samePosition } from './bitboard.js';
import {
  canonicalize,
  canonicalToDisplayAfterChild,
  inverseSymmetry,
  transformSquare
} from './symmetry.js';
import { NativeEdgeOutcome, NativeNodeStatus } from '../data/native-balanced-dag.js';

function balancedEdge(edge) {
  return edge.outcome === NativeEdgeOutcome.BALANCED || edge.outcome === NativeEdgeOutcome.PASS;
}

export class ExactTeachingSession {
  constructor(dag, rootId, { random = Math.random, control = 'single' } = {}) {
    this.dag = dag;
    this.rootId = rootId;
    this.nodeId = rootId;
    this.orientation = 0;
    this.turnColor = 0;
    this.studentColor = 0;
    this.control = control;
    this.random = random;
    this.phase = 'playing';
    this.history = [];
    this.attempts = [];
    this.lastFailure = null;
    this.startedAt = new Date().toISOString();
    this.autoPass();
  }

  get node() { return this.dag.node(this.nodeId); }
  get position() { return { player: this.node.player, opponent: this.node.opponent }; }
  get edges() { return this.dag.edgesForNode(this.nodeId); }
  get isStudentTurn() { return this.control === 'both' || this.turnColor === this.studentColor; }
  get empties() { return emptyCount(this.position); }

  displaySquare(canonicalSquare) {
    return canonicalSquare === PASS_MOVE ? PASS_MOVE : transformSquare(canonicalSquare, this.orientation);
  }

  canonicalSquare(displaySquare) {
    return displaySquare === PASS_MOVE
      ? PASS_MOVE
      : transformSquare(displaySquare, inverseSymmetry(this.orientation));
  }

  balancedEdges() { return this.edges.filter(balancedEdge); }
  balancedDisplayMoves() { return this.balancedEdges().map((edge) => this.displaySquare(edge.move)); }
  legalDisplayMoves() { return this.edges.map((edge) => this.displaySquare(edge.move)); }

  playStudentMove(displaySquare) {
    if (this.phase !== 'playing') return { accepted: false, reason: this.phase };
    if (!this.isStudentTurn) return { accepted: false, reason: 'computer-turn' };
    const move = this.canonicalSquare(displaySquare);
    const edge = this.edges.find((candidate) => candidate.move === move);
    if (!edge) return { accepted: false, reason: 'illegal' };

    const attempt = { nodeId: this.nodeId, displaySquare, move, outcome: edge.outcome };
    this.attempts.push(attempt);
    if (edge.outcome === NativeEdgeOutcome.FAILURE) {
      this.phase = 'review';
      this.lastFailure = attempt;
      return { accepted: false, reason: 'failure', edge };
    }
    if (!balancedEdge(edge)) {
      this.phase = 'error';
      return { accepted: false, reason: 'inconsistent-data', edge };
    }
    this.advance(edge, this.control === 'both' ? 'user' : 'student');
    return { accepted: true, edge };
  }

  retry() {
    if (this.phase !== 'review') return false;
    this.phase = 'playing';
    this.lastFailure = null;
    return true;
  }

  computerStep() {
    if (this.phase !== 'playing' || this.isStudentTurn) return null;
    const candidates = this.balancedEdges().filter((edge) => edge.move !== PASS_MOVE);
    if (candidates.length === 0) {
      this.autoPass();
      return null;
    }
    const edge = candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))];
    this.advance(edge, 'computer');
    return edge;
  }

  advance(edge, actor) {
    const before = this.position;
    const rawChild = edge.move === PASS_MOVE ? passTurn(before) : applyMove(before, edge.move);
    const canonical = canonicalize(rawChild);
    const child = this.dag.node(edge.childId);
    if (!samePosition(canonical.position, child)) {
      this.phase = 'error';
      throw new Error(`DAG edge ${edge.index} does not match child ${edge.childId}`);
    }

    this.history.push({
      actor,
      color: this.turnColor,
      nodeId: this.nodeId,
      childId: edge.childId,
      move: edge.move,
      displaySquare: this.displaySquare(edge.move),
      outcome: edge.outcome,
      emptiesBefore: emptyCount(before)
    });
    this.orientation = canonicalToDisplayAfterChild(this.orientation, canonical.symmetry);
    this.nodeId = edge.childId;
    this.turnColor = 1 - this.turnColor;
    this.lastFailure = null;

    if (this.node.status === NativeNodeStatus.TERMINAL_DRAW) {
      this.phase = 'terminal';
      this.finishedAt = new Date().toISOString();
      return;
    }
    if (this.node.status !== NativeNodeStatus.COMPLETE) {
      this.phase = 'error';
      throw new Error(`Node ${this.nodeId} is not an exact complete teaching node`);
    }
    this.autoPass();
  }

  autoPass() {
    while (this.phase === 'playing') {
      const moves = legalMoves(this.position);
      if (moves !== 0n) return;
      const edge = this.edges.find((candidate) => candidate.move === PASS_MOVE);
      if (!edge) {
        this.phase = 'error';
        throw new Error(`Node ${this.nodeId} requires pass but has no pass edge`);
      }
      this.advance(edge, 'auto-pass');
    }
  }

  snapshot() {
    return {
      version: 1,
      control: this.control,
      rootId: this.rootId,
      nodeId: this.nodeId,
      phase: this.phase,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt || null,
      attempts: [...this.attempts],
      history: [...this.history]
    };
  }
}
