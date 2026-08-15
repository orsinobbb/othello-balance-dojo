import { PASS_MOVE, popcount, squareName } from './core/bitboard.js';
import { ExactTeachingSession } from './core/session.js';
import { inverseSymmetry, transformSquare } from './core/symmetry.js';
import { ShardRepository } from './data/shard-repository.js';
import { ProgressStore } from './storage/progress-store.js';

const elements = Object.fromEntries([
  'board', 'turn', 'position-meta', 'black-count', 'white-count', 'empty-count',
  'feedback-title', 'feedback-text', 'hint', 'retry', 'next', 'replay', 'history',
  'evidence', 'fatal'
].map((id) => [id, document.getElementById(id)]));

const repository = new ShardRepository();
const progressStore = new ProgressStore();
let release;
let dag;
let shard;
let session;
let rootIndex = Number(localStorage.getItem('balance-dojo-root') || 0);
let hintsVisible = false;
let computerBusy = false;
let lastSnapshot = null;

function setFeedback(title, text) {
  elements['feedback-title'].textContent = title;
  elements['feedback-text'].textContent = text;
}

function occupiedColor(displaySquare) {
  const canonicalSquare = transformSquare(displaySquare, inverseSymmetry(session.orientation));
  const bit = 1n << BigInt(canonicalSquare);
  if ((session.node.player & bit) !== 0n) return session.turnColor === 0 ? 'black' : 'white';
  if ((session.node.opponent & bit) !== 0n) return session.turnColor === 0 ? 'white' : 'black';
  return null;
}

function renderBoard() {
  const legal = new Set(session.phase === 'playing' && session.isStudentTurn ? session.legalDisplayMoves() : []);
  const balanced = new Set(hintsVisible ? session.balancedDisplayMoves() : []);
  elements.board.replaceChildren();
  for (let square = 0; square < 64; square += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'square';
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', squareName(square));
    const color = occupiedColor(square);
    if (color) {
      const disc = document.createElement('span');
      disc.className = `disc ${color}`;
      button.append(disc);
    } else if (legal.has(square)) {
      button.classList.add('legal');
      if (balanced.has(square)) button.classList.add('hint');
      button.addEventListener('click', () => play(square));
    }
    if (session.lastFailure?.displaySquare === square) button.classList.add('failed');
    elements.board.append(button);
  }
}

function renderHistory() {
  elements.history.replaceChildren();
  const moves = session.history.filter((item) => item.move !== PASS_MOVE);
  if (moves.length === 0) {
    const item = document.createElement('li');
    item.textContent = '尚未落子';
    elements.history.append(item);
    return;
  }
  for (const item of moves) {
    const row = document.createElement('li');
    row.textContent = `${item.actor === 'student' ? '你' : '對手'}：${squareName(item.displaySquare)}（e${item.emptiesBefore}）`;
    elements.history.append(row);
  }
  elements.history.scrollTop = elements.history.scrollHeight;
}

function render() {
  const black = session.turnColor === 0 ? session.node.player : session.node.opponent;
  const white = session.turnColor === 0 ? session.node.opponent : session.node.player;
  elements['black-count'].textContent = popcount(black);
  elements['white-count'].textContent = popcount(white);
  elements['empty-count'].textContent = session.empties;
  elements['position-meta'].textContent = `題 ${rootIndex + 1}/${dag.rootCount} · node ${session.nodeId}`;
  elements.turn.textContent = session.phase === 'terminal'
    ? '精確和局完成'
    : session.isStudentTurn ? `你的回合（${session.studentColor === 0 ? '黑' : '白'}）` : '平衡對手思考中';
  elements.retry.hidden = session.phase !== 'review';
  elements.next.hidden = session.phase !== 'terminal';
  elements.replay.hidden = session.phase !== 'terminal';
  elements.hint.hidden = session.phase !== 'playing' || !session.isStudentTurn;
  elements.hint.textContent = hintsVisible ? '隱藏平衡落點' : '顯示平衡落點';
  renderBoard();
  renderHistory();
}

async function finish() {
  lastSnapshot = session.snapshot();
  setFeedback('完成一條精確平衡路徑', `共走 ${session.history.length} 個狀態；失衡嘗試 ${session.attempts.filter((item) => item.outcome === 2).length} 次。`);
  render();
  try { await progressStore.saveSession(lastSnapshot); } catch (error) { console.warn('Progress save failed', error); }
}

async function runComputer() {
  if (computerBusy) return;
  computerBusy = true;
  while (session.phase === 'playing' && !session.isStudentTurn) {
    render();
    await new Promise((resolve) => setTimeout(resolve, 260));
    session.computerStep();
  }
  computerBusy = false;
  if (session.phase === 'terminal') await finish();
  else if (session.phase === 'playing') {
    setFeedback('輪到你保持平衡', '白點是合法落點；需要時可顯示所有仍能維持和局的選擇。');
    render();
  }
}

function play(square) {
  hintsVisible = false;
  const result = session.playStudentMove(square);
  if (result.reason === 'failure') {
    setFeedback('這一步會失去平衡', '在雙方無失誤下，對手已有必勝策略。盤面保留不動；重試其他落點。');
    render();
    return;
  }
  if (!result.accepted) return;
  setFeedback('平衡路線成立', '這個落點仍能保證和局，繼續看對手的精確應手。');
  render();
  if (session.phase === 'terminal') finish(); else runComputer();
}

function startRoot(index) {
  rootIndex = ((index % dag.rootCount) + dag.rootCount) % dag.rootCount;
  localStorage.setItem('balance-dojo-root', String(rootIndex));
  session = new ExactTeachingSession(dag, dag.root(rootIndex));
  lastSnapshot = null;
  hintsVisible = false;
  setFeedback('找出所有平衡落點', '你執黑。合法落點不一定都能維持和局；本題接受資料中每一個精確平衡解。');
  render();
  runComputer();
}

async function replay() {
  if (!lastSnapshot) return;
  const records = lastSnapshot.history;
  session = new ExactTeachingSession(dag, lastSnapshot.rootId);
  setFeedback('重播中', '依序重現剛才走過的精確平衡路徑。');
  render();
  for (const record of records) {
    if (session.phase === 'terminal') break;
    if (session.nodeId !== record.nodeId) continue;
    await new Promise((resolve) => setTimeout(resolve, 360));
    const edge = session.edges.find((candidate) => candidate.move === record.move && candidate.childId === record.childId);
    if (!edge) throw new Error('無法重播：棋譜與目前資料版本不一致');
    session.advance(edge, record.actor);
    render();
  }
  lastSnapshot = session.snapshot();
  setFeedback('重播完成', '可進入下一題，或重新整理再次練習這一題。');
  render();
}

elements.hint.addEventListener('click', () => { hintsVisible = !hintsVisible; render(); });
elements.retry.addEventListener('click', () => { session.retry(); setFeedback('再試一次', '盤面未改變，找出仍能維持和局的落點。'); render(); });
elements.next.addEventListener('click', () => startRoot(rootIndex + 1));
elements.replay.addEventListener('click', () => replay().catch(showFatal));

function showFatal(error) {
  console.error(error);
  elements.fatal.hidden = false;
  elements.fatal.textContent = `無法啟動練習：${error.message}`;
  setFeedback('資料驗證失敗', '應用程式不會使用未通過完整性檢查的精算資料。');
}

async function main() {
  release = await repository.loadRelease('./data/release-manifest.json');
  shard = release.shards[0];
  ({ dag } = await repository.loadShard(release, shard));
  elements.evidence.textContent = `✓ SHA-256 已驗證 · ${dag.rootCount} 題 · ${(dag.byteLength / 1024).toFixed(0)} KiB`;
  startRoot(rootIndex);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

main().catch(showFatal);
