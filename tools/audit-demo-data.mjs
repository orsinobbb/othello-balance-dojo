import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { applyMove, legalMoves, PASS_MOVE, passTurn, samePosition } from '../src/core/bitboard.js';
import { canonicalize } from '../src/core/symmetry.js';
import { NativeBalancedDag, NativeEdgeOutcome, NativeNodeStatus } from '../src/data/native-balanced-dag.js';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('data/release-manifest.json', root), 'utf8'));
const shard = manifest.shards[0];
const bytes = await readFile(new URL(`data/${shard.url}`, root));
const digest = createHash('sha256').update(bytes).digest('hex');
if (bytes.byteLength !== shard.bytes) throw new Error(`Byte mismatch: ${bytes.byteLength}`);
if (digest !== shard.sha256) throw new Error(`SHA-256 mismatch: ${digest}`);

const dag = new NativeBalancedDag(bytes);
if (dag.rootCount !== shard.roots.length) throw new Error('Root count mismatch');
const statuses = { complete:0, terminalDraw:0, boundaryWin:0, boundaryLoss:0 };
const outcomes = { balanced:0, failure:0, winningDeviation:0, pass:0 };

for (let nodeId = 0; nodeId < dag.nodeCount; nodeId += 1) {
  const node = dag.node(nodeId);
  if (node.status === NativeNodeStatus.COMPLETE) statuses.complete += 1;
  else if (node.status === NativeNodeStatus.TERMINAL_DRAW) statuses.terminalDraw += 1;
  else if (node.status === NativeNodeStatus.BOUNDARY_WIN) statuses.boundaryWin += 1;
  else if (node.status === NativeNodeStatus.BOUNDARY_LOSS) statuses.boundaryLoss += 1;
  else throw new Error(`Unexpected node status ${node.status} at ${nodeId}`);
  const position = { player:node.player, opponent:node.opponent };
  for (const edge of dag.edgesForNode(nodeId)) {
    if (edge.outcome === NativeEdgeOutcome.BALANCED) outcomes.balanced += 1;
    else if (edge.outcome === NativeEdgeOutcome.FAILURE) outcomes.failure += 1;
    else if (edge.outcome === NativeEdgeOutcome.WINNING_DEVIATION) outcomes.winningDeviation += 1;
    else if (edge.outcome === NativeEdgeOutcome.PASS) outcomes.pass += 1;
    else throw new Error(`Unknown edge outcome ${edge.outcome}`);
    const raw = edge.move === PASS_MOVE ? passTurn(position) : applyMove(position, edge.move);
    if (edge.move === PASS_MOVE && legalMoves(position) !== 0n) throw new Error(`Illegal pass at node ${nodeId}`);
    if (!samePosition(canonicalize(raw).position, dag.node(edge.childId))) {
      throw new Error(`Child mismatch at edge ${edge.index}`);
    }
  }
}

console.log(JSON.stringify({ file:fileURLToPath(new URL(`data/${shard.url}`, root)), bytes:bytes.byteLength, sha256:digest, nodes:dag.nodeCount, edges:dag.edgeCount, roots:dag.rootCount, statuses, outcomes }, null, 2));
