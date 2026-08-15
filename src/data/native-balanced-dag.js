const MAGIC = 'OTBDAG01';
const HEADER_SIZE = 56;

export const NativeNodeStatus = Object.freeze({
  EXPANDING: 1,
  COMPLETE: 2,
  TERMINAL_DRAW: 3,
  FRONTIER: 4,
  BOUNDARY_WIN: 5,
  BOUNDARY_LOSS: 6,
  TRUNCATED: 7,
  INCONSISTENT: 8
});

export const NativeEdgeOutcome = Object.freeze({
  BALANCED: 1,
  FAILURE: 2,
  WINNING_DEVIATION: 3,
  PASS: 4
});

function asArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  throw new TypeError('NativeBalancedDag expects an ArrayBuffer or typed array');
}

function safeNumber(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} is too large for JavaScript indexing`);
  }
  return Number(value);
}

function checkedId(id, count, label) {
  if (!Number.isSafeInteger(id) || id < 0 || id >= count) {
    throw new RangeError(`${label} ${id} is outside DAG`);
  }
}

export class NativeBalancedDag {
  constructor(input) {
    this.buffer = asArrayBuffer(input);
    if (this.buffer.byteLength < HEADER_SIZE) {
      throw new Error('Native balanced DAG header is truncated');
    }
    this.view = new DataView(this.buffer);
    const magic = new TextDecoder('ascii').decode(new Uint8Array(this.buffer, 0, 8));
    if (magic !== MAGIC) throw new Error('Invalid native balanced DAG');

    this.version = this.view.getUint32(8, true);
    this.nodeSize = this.view.getUint32(12, true);
    this.edgeSize = this.view.getUint32(16, true);
    this.flags = this.view.getUint32(20, true);
    this.nodeCount = safeNumber(this.view.getBigUint64(24, true), 'nodeCount');
    this.edgeCount = safeNumber(this.view.getBigUint64(32, true), 'edgeCount');
    this.rootCount = safeNumber(this.view.getBigUint64(40, true), 'rootCount');

    if (this.version !== 1 || this.nodeSize !== 32 || this.edgeSize !== 16) {
      throw new Error(`Unsupported native balanced DAG layout v${this.version}/${this.nodeSize}/${this.edgeSize}`);
    }

    this.nodeBase = HEADER_SIZE;
    this.edgeBase = this.nodeBase + this.nodeCount * this.nodeSize;
    this.rootBase = this.edgeBase + this.edgeCount * this.edgeSize;
    const requiredBytes = this.rootBase + this.rootCount * 8;
    if (!Number.isSafeInteger(requiredBytes) || this.buffer.byteLength < requiredBytes) {
      throw new Error(`Native balanced DAG is truncated: expected ${requiredBytes} bytes`);
    }
    this.byteLength = requiredBytes;
  }

  node(id) {
    checkedId(id, this.nodeCount, 'Node');
    const offset = this.nodeBase + id * this.nodeSize;
    return {
      id,
      player: this.view.getBigUint64(offset, true),
      opponent: this.view.getBigUint64(offset + 8, true),
      firstEdge: safeNumber(this.view.getBigUint64(offset + 16, true), 'firstEdge'),
      edgeCount: this.view.getUint32(offset + 24, true),
      status: this.view.getUint8(offset + 28),
      empties: this.view.getUint8(offset + 29),
      valueSign: this.view.getInt8(offset + 30),
      flags: this.view.getUint8(offset + 31)
    };
  }

  edge(index) {
    checkedId(index, this.edgeCount, 'Edge');
    const offset = this.edgeBase + index * this.edgeSize;
    return {
      index,
      childId: safeNumber(this.view.getBigUint64(offset, true), 'childId'),
      move: this.view.getUint8(offset + 8),
      outcome: this.view.getUint8(offset + 9),
      childBound: this.view.getUint8(offset + 10),
      childValue: this.view.getInt8(offset + 11)
    };
  }

  root(index = 0) {
    checkedId(index, this.rootCount, 'Root');
    return safeNumber(this.view.getBigUint64(this.rootBase + index * 8, true), 'rootId');
  }

  edgesForNode(id) {
    const node = this.node(id);
    if (node.firstEdge + node.edgeCount > this.edgeCount) {
      throw new Error(`Node ${id} has invalid edge range`);
    }
    return Array.from({ length: node.edgeCount }, (_, index) => this.edge(node.firstEdge + index));
  }
}
