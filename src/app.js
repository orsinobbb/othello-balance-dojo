import { PASS_MOVE, popcount, squareName } from './core/bitboard.js';
import { ExactTeachingSession } from './core/session.js';
import { inverseSymmetry, transformSquare } from './core/symmetry.js';
import { analyzeTurn } from './core/teaching.js';
import { ShardRepository } from './data/shard-repository.js';
import { isLessonAvailable, isLessonCompleted, loadCurriculum, recordLessonSuccess } from './storage/curriculum-store.js';
import { ProgressStore } from './storage/progress-store.js';

const elements = Object.fromEntries([
  'board', 'turn', 'position-meta', 'black-count', 'white-count', 'empty-count',
  'lesson-step', 'lesson-title', 'lesson-body', 'analysis-next', 'reveal', 'retry',
  'next', 'replay', 'history', 'evidence', 'fatal', 'root-select', 'question-progress', 'last-result'
].map((id) => [id, document.getElementById(id)]));

const repository = new ShardRepository();
const progressStore = new ProgressStore();
let release;
let dag;
let shard;
let session;
let curriculum;
let rootIndex = Number(localStorage.getItem('balance-dojo-root') || 0);
let lessonStage = 0;
let lastSnapshot = null;
let lastResult = '';
let loadRequest = 0;

function occupiedColor(displaySquare) {
  const canonicalSquare = transformSquare(displaySquare, inverseSymmetry(session.orientation));
  const bit = 1n << BigInt(canonicalSquare);
  if ((session.node.player & bit) !== 0n) return session.turnColor === 0 ? 'black' : 'white';
  if ((session.node.opponent & bit) !== 0n) return session.turnColor === 0 ? 'white' : 'black';
  return null;
}

function addParagraph(parent, text, className = '') {
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  if (className) paragraph.className = className;
  parent.append(paragraph);
}

function addList(parent, items, formatter) {
  const list = document.createElement('ul');
  list.className = 'lesson-list';
  for (const item of items) {
    const row = document.createElement('li');
    row.textContent = formatter(item);
    list.append(row);
  }
  parent.append(list);
}

function names(facts) {
  return facts.map((fact) => fact.name).join('、') || '沒有';
}

function renderExactTable(analysis, parent) {
  const table = document.createElement('div');
  table.className = 'move-table';
  const header = document.createElement('div');
  header.className = 'move-row move-head';
  for (const label of ['落點', '區域／翻子', '對手可下', '精算']) {
    const cell = document.createElement('span');
    cell.textContent = label;
    header.append(cell);
  }
  table.append(header);
  for (const fact of analysis.facts) {
    const row = document.createElement('div');
    row.className = `move-row ${fact.balanced ? 'is-balanced' : 'is-failure'}`;
    for (const value of [fact.name, `${fact.regionSize} 格／${fact.flips} 子`, `${fact.opponentMobility} 手`, fact.exact]) {
      const cell = document.createElement('span');
      cell.textContent = value;
      row.append(cell);
    }
    table.append(row);
  }
  parent.append(table);
}

function renderLesson(analysis) {
  const body = elements['lesson-body'];
  body.replaceChildren();

  if (session.phase === 'terminal') {
    elements['lesson-step'].textContent = '終局驗證';
    elements['lesson-title'].textContent = '雙方都守住了和局';
    addParagraph(body, `從 e20 走到終局，每一手都留在完整搜尋證明的平衡拓樸中。你剛才同時替黑棋與白棋做了決策。`);
    addParagraph(body, '現在可以重播整條推理路徑，或切換下一題。', 'takeaway');
    return;
  }

  if (session.phase === 'review') {
    const failed = analysis.facts.find((fact) => fact.displaySquare === session.lastFailure?.displaySquare);
    elements['lesson-step'].textContent = '失衡檢討';
    elements['lesson-title'].textContent = `${analysis.color}下 ${failed?.name || '這一手'} 後，對手可強制獲勝`;
    if (failed) {
      addParagraph(body, `這手翻 ${failed.flips} 子，讓對手有 ${failed.opponentMobility} 個合法手，落在 ${failed.regionSize} 格空區。這些是人類可觀察的警訊，但不是失敗的單一原因。`);
    }
    addParagraph(body, '真正判定來自完整搜尋：這個分支已經離開和局集合。比較下表後，保留同一盤面再試一次。', 'takeaway');
    renderExactTable(analysis, body);
    return;
  }

  elements['lesson-step'].textContent = `逐手教學 · ${analysis.color}棋思考`;
  if (lessonStage === 0) {
    elements['lesson-title'].textContent = '第一步：先讀空格區域，不數目前棋子';
    addParagraph(body, `現在剩 ${analysis.empties} 格，${analysis.color}有 ${analysis.legalCount} 個合法手。空格連通區大小是 ${analysis.regions.map((region) => region.size).join('、')}。`);
    addList(body, analysis.regions, (region) => `${region.size} 格區：${region.names.join('、')}`);
    if (analysis.largestRegion >= 5) {
      const largeMoves = analysis.facts.filter((fact) => fact.regionSize === analysis.largestRegion);
      if (largeMoves.length > 0) {
        addParagraph(body, `最大區有 ${analysis.largestRegion} 格。${names(largeMoves)} 會立刻進入這一區，第一輪先降級，不代表已被精算判輸。`, 'takeaway');
      } else {
        addParagraph(body, `最大區有 ${analysis.largestRegion} 格，但目前沒有合法手直接進入；先保留這塊區域，再比較其他落點。`, 'takeaway');
      }
    } else {
      addParagraph(body, '沒有特別巨大的空區，下一步直接比較每手送給對方多少選擇。', 'takeaway');
    }
  } else if (lessonStage === 1) {
    elements['lesson-title'].textContent = '第二步：用對手行動力縮小候選';
    addParagraph(body, `不要被「翻很多」吸引。逐手快算後，對手最少有 ${analysis.lowestMobility} 個合法手；把門檻放在最少值加一，可先留下 ${names(analysis.shortlist)}。`);
    addList(body, analysis.shortlist, (fact) => `${fact.name}：翻 ${fact.flips} 子，對手 ${fact.opponentMobility} 手，位於 ${fact.regionSize} 格區。`);
    const noisy = analysis.facts.filter((fact) => !analysis.shortlist.includes(fact)).sort((left, right) => right.opponentMobility - left.opponentMobility).slice(0, 3);
    if (noisy.length > 0) addParagraph(body, `相較之下，${noisy.map((fact) => `${fact.name} 讓對手有 ${fact.opponentMobility} 手`).join('；')}，暫時降級。`, 'takeaway');
  } else if (lessonStage === 2) {
    elements['lesson-title'].textContent = '第三步：找雙方都想拿的節奏格';
    if (analysis.sharedSingletons.length > 0) {
      addParagraph(body, `${names(analysis.sharedSingletons)} 是孤立單格，而且換對手走時也能下。你現在不填，對方下一手可能就會把這個 tempo 拿走。`);
      addParagraph(body, '重點不是這顆棋能否永久保留，而是這個空格由誰花掉一手；棋子日後被翻回去，已填掉的手數仍不會重來。', 'takeaway');
    } else {
      addParagraph(body, '這一手沒有「雙方共用的孤立單格」。改看奇數區由誰先進、以及落子後是否被迫替對方開角。');
    }
    const cornerGifts = analysis.facts.filter((fact) => fact.openedCorners.length > 0);
    if (cornerGifts.length > 0) {
      addList(body, cornerGifts, (fact) => `${fact.name} 後會讓對手能下角落 ${fact.openedCorners.join('、')}。這是代價，仍需和手數收益一起算。`);
      addParagraph(body, '「送角」不會自動成為妙手；只有當搶到的節奏足以補償角落，完整搜尋才會接受。', 'warning-note');
    }
  } else {
    elements['lesson-title'].textContent = '第四步：完整搜尋負責最後證明';
    addParagraph(body, `人類原則把 ${analysis.legalCount} 手縮成候選，但不能單獨證明答案。精算結果：${names(analysis.balanced)} 能維持和局，其餘 ${analysis.failures.length} 手在雙方無失誤下必敗。`);
    renderExactTable(analysis, body);
    addParagraph(body, '金色落點是資料中所有可繼續維持和局的選擇；這份資料目前證明勝負類別，不虛構未保存的最終子差。', 'takeaway');
  }
}

function renderBoard(analysis) {
  const legal = new Set(session.phase === 'playing' ? session.legalDisplayMoves() : []);
  const balanced = new Set(analysis && (lessonStage === 3 || session.phase === 'review') ? analysis.balanced.map((fact) => fact.displaySquare) : []);
  const candidates = new Set(analysis && lessonStage >= 1 && lessonStage < 3 ? analysis.shortlist.map((fact) => fact.displaySquare) : []);
  const tempos = new Set(analysis && lessonStage === 2 ? analysis.sharedSingletons.map((fact) => fact.displaySquare) : []);
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
      if (candidates.has(square)) button.classList.add('candidate');
      if (tempos.has(square)) button.classList.add('tempo');
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
    const color = item.color === 0 ? '黑' : '白';
    row.textContent = `${color}：${squareName(item.displaySquare)}（e${item.emptiesBefore}）· 維持和局`;
    elements.history.append(row);
  }
  elements.history.scrollTop = elements.history.scrollHeight;
}

function renderProgress() {
  document.querySelectorAll('[data-lesson-step]').forEach((item) => {
    const value = Number(item.dataset.lessonStep);
    item.classList.toggle('active', value === lessonStage);
    item.classList.toggle('done', value < lessonStage);
  });
}

function render() {
  const black = session.turnColor === 0 ? session.node.player : session.node.opponent;
  const white = session.turnColor === 0 ? session.node.opponent : session.node.player;
  const analysis = session.phase === 'terminal' ? null : analyzeTurn(session);
  elements['black-count'].textContent = popcount(black);
  elements['white-count'].textContent = popcount(white);
  elements['empty-count'].textContent = session.empties;
  elements['position-meta'].textContent = `題目 ${String(rootIndex + 1).padStart(3, '0')}/${release.lessonCount} · node ${session.nodeId}`;
  elements.turn.textContent = session.phase === 'terminal'
    ? '精確和局完成'
    : `${session.turnColor === 0 ? '黑方' : '白方'}由你下 · ${session.legalDisplayMoves().length} 個合法手`;

  elements['last-result'].hidden = !lastResult;
  elements['last-result'].textContent = lastResult;
  elements.retry.hidden = session.phase !== 'review';
  elements.next.hidden = session.phase !== 'terminal' || rootIndex >= release.lessonCount - 1;
  elements.replay.hidden = session.phase !== 'terminal';
  elements['analysis-next'].hidden = session.phase !== 'playing';
  elements.reveal.hidden = session.phase !== 'playing' || lessonStage === 3;
  elements['analysis-next'].textContent = ['下一步：篩選候選', '下一步：找節奏格', '下一步：精算證明', '重新走一次思考'][lessonStage];
  renderProgress();
  renderLesson(analysis);
  renderBoard(analysis);
  renderHistory();
}

async function finish() {
  lastSnapshot = session.snapshot();
  curriculum = recordLessonSuccess(localStorage, release.lessons, rootIndex, { moves: lastSnapshot.history.length });
  populateRootSelect();
  lastResult = `終局確認：黑 ${elements['black-count'].textContent}、白 ${elements['white-count'].textContent}，結果和局。`;
  render();
  try { await progressStore.saveSession(lastSnapshot); } catch (error) { console.warn('Progress save failed', error); }
}

function play(square) {
  const before = analyzeTurn(session);
  const fact = before.facts.find((candidate) => candidate.displaySquare === square);
  const movingColor = before.color;
  const result = session.playStudentMove(square);
  if (result.reason === 'failure') {
    lessonStage = 3;
    lastResult = `${movingColor} ${fact?.name || squareName(square)}：完整搜尋判定必敗，盤面保留供你比較。`;
    render();
    return;
  }
  if (!result.accepted) return;
  lastResult = `${movingColor} ${fact.name}：維持和局；翻 ${fact.flips} 子，下一方原有 ${fact.opponentMobility} 個合法選擇。`;
  lessonStage = 0;
  if (session.phase === 'terminal') {
    finish();
    return;
  }
  render();
}

async function startRoot(index) {
  const requested = Math.max(0, Math.min(release.lessonCount - 1, Number(index) || 0));
  const selected = isLessonAvailable(curriculum, requested) ? requested : curriculum.unlockedThrough;
  const request = ++loadRequest;
  elements['root-select'].disabled = true;
  elements.evidence.textContent = `正在載入第 ${String(selected + 1).padStart(3, '0')} 題所需分片…`;
  const loaded = await repository.loadLesson(release, release.lessons[selected]);
  if (request !== loadRequest) return;
  ({ dag, shard } = loaded);
  rootIndex = selected;
  localStorage.setItem('balance-dojo-root', String(rootIndex));
  elements['root-select'].value = String(rootIndex);
  session = new ExactTeachingSession(dag, dag.root(release.lessons[rootIndex].rootIndex), { control: 'both' });
  lastSnapshot = null;
  lastResult = '';
  lessonStage = 0;
  elements.evidence.textContent = `✓ SHA-256 已驗證 · ${release.lessonCount} 題 · 已載入 ${repository.loadedShardCount(release)}/${release.shards.length} 分片（${(repository.loadedBytes(release) / 1048576).toFixed(1)} MB）`;
  populateRootSelect();
  render();
}

async function replay() {
  if (!lastSnapshot) return;
  const records = lastSnapshot.history;
  session = new ExactTeachingSession(dag, lastSnapshot.rootId, { control: 'both' });
  lastResult = '重播中：依序重現黑白雙方剛才走過的平衡路徑。';
  lessonStage = 3;
  render();
  for (const record of records) {
    if (session.phase === 'terminal') break;
    if (session.nodeId !== record.nodeId) continue;
    await new Promise((resolve) => setTimeout(resolve, 320));
    const edge = session.edges.find((candidate) => candidate.move === record.move && candidate.childId === record.childId);
    if (!edge) throw new Error('無法重播：棋譜與目前資料版本不一致');
    session.advance(edge, record.actor);
    render();
  }
  lastSnapshot = session.snapshot();
  lastResult = '重播完成：可進入下一題。';
  render();
}

elements['analysis-next'].addEventListener('click', () => {
  lessonStage = lessonStage === 3 ? 0 : lessonStage + 1;
  render();
});
elements.reveal.addEventListener('click', () => { lessonStage = 3; render(); });
elements.retry.addEventListener('click', () => {
  session.retry();
  lessonStage = 0;
  lastResult = '盤面未改變。重新從空格區域開始判斷。';
  render();
});
elements.next.addEventListener('click', () => startRoot(rootIndex + 1).catch(showFatal));
elements.replay.addEventListener('click', () => replay().catch(showFatal));
elements['root-select'].addEventListener('change', () => startRoot(Number(elements['root-select'].value)).catch(showFatal));

function showFatal(error) {
  console.error(error);
  elements['root-select'].disabled = false;
  elements.fatal.hidden = false;
  elements.fatal.textContent = `無法啟動練習：${error.message}`;
}

function populateRootSelect() {
  elements['root-select'].replaceChildren();
  for (let index = 0; index < release.lessonCount; index += 1) {
    const option = document.createElement('option');
    option.value = String(index);
    const title = release.lessons[index].title ? ` · ${release.lessons[index].title}` : '';
    const status = isLessonCompleted(curriculum, index)
      ? ' · ✓ 已完成'
      : index === curriculum.unlockedThrough ? ' · 目前關卡' : ' · 🔒 未解鎖';
    option.textContent = `第 ${String(index + 1).padStart(3, '0')} 題${title}${status}`;
    option.disabled = !isLessonAvailable(curriculum, index);
    elements['root-select'].append(option);
  }
  elements['root-select'].value = String(rootIndex);
  elements['root-select'].disabled = false;
  elements['question-progress'].textContent = curriculum.completedCount === release.lessonCount
    ? `全部 ${release.lessonCount} 題完成，可自由複習`
    : `已完成 ${curriculum.completedCount}/${release.lessonCount} · 下一關：第 ${String(curriculum.unlockedThrough + 1).padStart(3, '0')} 題`;
}

async function main() {
  release = await repository.loadRelease('./data/release-manifest.json');
  curriculum = loadCurriculum(localStorage, release.lessons);
  if (!isLessonAvailable(curriculum, rootIndex)) rootIndex = curriculum.unlockedThrough;
  populateRootSelect();
  await startRoot(Number.isFinite(rootIndex) ? rootIndex : 0);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

main().catch(showFatal);
