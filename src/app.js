import { PASS_MOVE, popcount, squareName } from './core/bitboard.js';
import { ExactTeachingSession } from './core/session.js';
import { inverseSymmetry, transformSquare } from './core/symmetry.js';
import { analyzeTurn } from './core/teaching.js';
import { createLearningEvent, LearningEventType, MasteryState, projectLearningState } from './core/learning-model.js';
import { buildDailyPlan, lessonConcepts } from './curriculum/adaptive-selector.js';
import { ShardRepository } from './data/shard-repository.js';
import { isLessonAvailable, isLessonCompleted, loadCurriculum, recordLessonSuccess } from './storage/curriculum-store.js';
import { ProgressStore } from './storage/progress-store.js';
import { runtimeConfig } from './config/runtime-config.js';
import { createAuthProvider } from './auth/auth-provider.js';
import { SupabaseEventSyncAdapter, SyncEngine } from './sync/sync-engine.js';

const elements = Object.fromEntries([
  'board', 'turn', 'position-meta', 'black-count', 'white-count', 'empty-count',
  'lesson-step', 'lesson-title', 'lesson-body', 'analysis-next', 'reveal', 'retry',
  'next', 'replay', 'history', 'evidence', 'fatal', 'root-select', 'question-progress', 'last-result',
  'failure-dialog', 'failure-dialog-title', 'failure-dialog-body', 'failure-dialog-close', 'failure-dialog-retry',
  'sync-pill', 'today-greeting', 'today-count', 'due-count', 'active-days', 'daily-plan', 'start-daily',
  'course-progress', 'concept-map', 'continue-course', 'stat-completed', 'stat-accuracy', 'stat-independent',
  'mastery-list', 'recent-activity', 'profile-name', 'profile-experience', 'profile-minutes', 'save-profile',
  'identity-title', 'identity-detail', 'auth-action', 'sync-action', 'sync-status', 'export-data',
  'onboarding-dialog', 'onboarding-experience', 'onboarding-minutes', 'onboarding-start'
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
let profile;
let projection = projectLearningState([]);
let learningEvents = [];
let dailyPlan = [];
let authProvider;
let syncEngine;
let identity;
let sessionId = null;
let nodeStartedAt = performance.now();
const appConfig = runtimeConfig();

const CONCEPT_LABELS = Object.freeze({
  'take-corner': '取得角落',
  'deny-corner': '避免立即送角',
  'forced-pass': '逼迫對手停著',
  'shared-singleton': '共用孤立單格',
  'empty-c-risk': '空角旁 C 格風險',
  'opponent-mobility': '壓縮對手行動力',
  'reply-resilience': '承受對手最佳回應',
  'avoid-reply-pass': '避免被對手反逼停',
  'frontier-discipline': '減少新增前沿子',
  'empty-x-risk': '空角旁 X 格風險',
  'potential-mobility': '潛在行動力',
  'anchored-edge': '增加角落錨定邊線',
  'odd-region': '優先奇數空區',
  'preserve-large-region': '保留大空區',
  'flip-economy': '少翻子保留彈性',
  'corner': '角落策略',
  'mobility': '行動力控制',
  'stability': '穩定子與邊線',
  'parity': '空區奇偶',
  'frontier': '前沿子管理',
  'region-parity': '區域奇偶',
  'corner-access': '角落控制',
  'frontier-discs': '前線棋控制',
  'edge-stability': '邊線穩定度',
  'tempo': '手數／節奏'
});

function conceptLabel(id) {
  const clean = String(id || '').replace(/^family:/, '');
  return CONCEPT_LABELS[clean] || clean.replaceAll('-', ' ');
}

function switchView(view, { updateHash = true } = {}) {
  const target = document.querySelector(`[data-view="${view}"]`) ? view : 'today';
  document.querySelectorAll('[data-view]').forEach((section) => { section.hidden = section.dataset.view !== target; });
  document.querySelectorAll('[data-view-target]').forEach((button) => button.classList.toggle('active', button.dataset.viewTarget === target));
  if (updateHash && location.hash !== `#${target}`) history.replaceState(null, '', `#${target}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function recordEvent(eventType, fields = {}, { refresh = true, queue = true } = {}) {
  if (!profile) return null;
  const clientSeq = await progressStore.nextClientSeq();
  profile.clientSeq = clientSeq;
  const lesson = release?.lessons?.[rootIndex];
  const event = createLearningEvent({
    eventType,
    profileId: profile.id,
    deviceId: profile.installationId,
    sessionId,
    clientSeq,
    datasetId: release?.datasetId,
    lessonId: lesson?.id,
    positionId: fields.positionId || session?.nodeId?.toString?.() || null,
    conceptTags: lesson ? lessonConcepts(lesson) : [],
    ...fields
  });
  await progressStore.appendEvent(event, { queue });
  if (refresh) await refreshLearningState();
  return event;
}

async function refreshLearningState() {
  learningEvents = await progressStore.listEvents();
  projection = projectLearningState(learningEvents);
  await progressStore.saveProjection(projection);
  if (release) renderLearningShell();
}

function masteryText(state) {
  return ({
    [MasteryState.LEARNING]: '學習中',
    [MasteryState.RECOGNISABLE]: '可辨識',
    [MasteryState.STABLE]: '穩定',
    [MasteryState.TRANSFER_READY]: '可遷移'
  })[state] || '尚未練習';
}

function createLessonTile(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lesson-tile';
  const tag = document.createElement('small');
  tag.className = 'reason-tag';
  tag.textContent = item.reason;
  const title = document.createElement('span');
  title.textContent = `第 ${String(item.index + 1).padStart(3, '0')} 題 · ${item.lesson.title || '平衡判斷'}`;
  const detail = document.createElement('small');
  const p = item.lesson.pedagogy || {};
  detail.textContent = `${difficultyLabel(p.difficulty)} · ${p.legalMoveCount || '—'} 選 ${p.balancedMoveCount || '—'} · ${conceptLabel(p.primaryTheoryId)}`;
  button.append(tag, title, detail);
  button.addEventListener('click', () => {
    switchView('practice');
    startRoot(item.index).catch(showFatal);
  });
  return button;
}

function renderDailyPlan() {
  const size = Math.max(3, Math.min(10, Math.ceil(Number(profile?.dailyMinutes || 10) / 2)));
  dailyPlan = buildDailyPlan(release.lessons, projection, { size });
  elements['daily-plan'].replaceChildren(...dailyPlan.map(createLessonTile));
  elements['today-count'].textContent = dailyPlan.length;
  elements['due-count'].textContent = projection.dueReviews.length;
  elements['active-days'].textContent = projection.totals.activeDays;
  elements['today-greeting'].textContent = profile?.displayName
    ? `${profile.displayName}，今天從最值得複習的決策開始`
    : '今天從最值得複習的決策開始';
}

function renderCourse() {
  const completed = projection.completedLessons.length || curriculum.completedCount;
  elements['course-progress'].textContent = `${completed}/${release.lessonCount} 題`;
  const counts = new Map();
  for (const lesson of release.lessons) {
    for (const concept of lessonConcepts(lesson)) counts.set(concept, (counts.get(concept) || 0) + 1);
  }
  const mastered = new Map(projection.mastery.map((row) => [row.conceptId, row]));
  const concepts = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9);
  elements['concept-map'].replaceChildren(...concepts.map(([conceptId, count]) => {
    const card = document.createElement('article');
    card.className = 'concept-card';
    const title = document.createElement('strong');
    title.textContent = conceptLabel(conceptId);
    const detail = document.createElement('span');
    detail.textContent = `${count} 題 · ${masteryText(mastered.get(conceptId)?.state)}`;
    card.append(title, detail);
    return card;
  }));
}

function renderProgressDashboard() {
  const totals = projection.totals;
  const accuracy = totals.attempts ? Math.round(totals.valuePreserving / totals.attempts * 100) : null;
  const independent = learningEvents.filter((event) => event.eventType === LearningEventType.MOVE_ATTEMPTED && event.hintLevel === 0).length;
  elements['stat-completed'].textContent = projection.completedLessons.length || curriculum.completedCount;
  elements['stat-accuracy'].textContent = accuracy === null ? '—' : `${accuracy}%`;
  elements['stat-independent'].textContent = independent;

  if (!projection.mastery.length) {
    elements['mastery-list'].replaceChildren();
    addParagraph(elements['mastery-list'], '完成練習後，這裡會用答題、提示程度與跨題成功來呈現熟練度。');
  } else {
    elements['mastery-list'].replaceChildren(...projection.mastery.slice(0, 12).map((record) => {
      const row = document.createElement('div');
      row.className = 'mastery-row';
      const label = document.createElement('b');
      label.textContent = conceptLabel(record.conceptId);
      const track = document.createElement('span');
      track.className = 'mastery-track';
      const fill = document.createElement('i');
      fill.style.width = `${Math.round(record.score * 100)}%`;
      track.append(fill);
      const state = document.createElement('small');
      state.textContent = masteryText(record.state);
      row.append(label, track, state);
      return row;
    }));
  }

  const recent = learningEvents.filter((event) => [LearningEventType.MOVE_ATTEMPTED, LearningEventType.LESSON_COMPLETED].includes(event.eventType)).slice(-8).reverse();
  if (!recent.length) {
    elements['recent-activity'].replaceChildren();
    addParagraph(elements['recent-activity'], '尚無紀錄。');
  } else {
    elements['recent-activity'].replaceChildren(...recent.map((event) => {
      const row = document.createElement('div');
      row.className = 'activity-row';
      const text = document.createElement('span');
      text.textContent = event.eventType === LearningEventType.LESSON_COMPLETED
        ? `完成 ${event.lessonId}`
        : `${event.side || '本手'} ${event.move || ''} · ${event.outcome === 'value_preserving' ? '維持平衡' : '失去平衡'}`;
      const time = document.createElement('small');
      time.textContent = new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(event.occurredAt));
      row.append(text, time);
      return row;
    }));
  }
}

async function renderAccountStatus() {
  if (!authProvider || !syncEngine) return;
  identity = await authProvider.getIdentity();
  const status = await syncEngine.status();
  elements['identity-title'].textContent = identity.authenticated ? identity.displayName : '目前使用本機模式';
  elements['identity-detail'].textContent = identity.authenticated
    ? `${identity.email || 'Google 帳號'} · 可跨裝置同步學習事件`
    : '不登入也能完整練習，資料只留在這個瀏覽器。';
  elements['auth-action'].disabled = authProvider.kind !== 'supabase';
  elements['auth-action'].textContent = authProvider.kind !== 'supabase'
    ? 'Google 登入尚未設定'
    : identity.authenticated ? '登出 Google 帳號' : '使用 Google 登入';
  elements['sync-action'].disabled = !identity.authenticated;
  elements['sync-pill'].textContent = identity.authenticated ? `雲端同步 · 待傳 ${status.pending}` : `本機保存 · ${status.pending} 筆事件`;
  elements['sync-status'].textContent = identity.authenticated
    ? (status.remote?.syncedAt ? `上次同步：${new Date(status.remote.syncedAt).toLocaleString('zh-TW')}` : '已登入，尚未首次同步。')
    : '登入前的紀錄保留在本機；登入後可安全合併。';
}

function renderLearningShell() {
  renderDailyPlan();
  renderCourse();
  renderProgressDashboard();
  if (profile) {
    elements['profile-name'].value = profile.displayName || '';
    elements['profile-experience'].value = profile.experience || 'new';
    elements['profile-minutes'].value = String(profile.dailyMinutes || 10);
  }
  renderAccountStatus().catch((error) => {
    elements['sync-status'].textContent = `同步狀態讀取失敗：${error.message}`;
  });
}

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

function difficultyLabel(value) {
  return ({ foundation: '基礎', intermediate: '中階', advanced: '高階' })[value] || '未分級';
}

function theoryReasons(fact, limit = 2) {
  return fact.theorySignals
    .filter((signal) => signal.contribution > 0)
    .slice(0, limit)
    .map((signal) => signal.observation.replace(/[。！？；]+$/u, ''))
    .join('；');
}

function closeFailureDialog() {
  const dialog = elements['failure-dialog'];
  if (dialog.open) dialog.close();
}

function showFailureDialog(analysis, failed) {
  const dialog = elements['failure-dialog'];
  elements['failure-dialog-title'].textContent = `${analysis.color}下 ${failed?.name || '這一手'}，會失去和局`;
  const body = elements['failure-dialog-body'];
  body.replaceChildren();
  addParagraph(body, '完整搜尋已證明：雙方都無失誤時，這個分支會被對手強制獲勝。這不是立即輸棋，而是已經離開平衡路線。');
  if (failed) {
    addParagraph(body, `盤面線索：翻 ${failed.flips} 子、讓對手有 ${failed.opponentMobility} 個合法手，並進入 ${failed.regionSize} 格空區。這些是檢討線索，不是單獨的證明。`, 'dialog-clue');
    const reasons = theoryReasons(failed);
    if (reasons) addParagraph(body, `棋理引擎當時觀察到：${reasons}。請把它和已證明的平衡手比較，不把單一規則當答案。`, 'dialog-clue');
  }
  addParagraph(body, `回到原盤後，重新比較 ${names(analysis.balanced)}。頁面下方也保留完整落點表。`, 'dialog-answer');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  elements['failure-dialog-retry'].focus();
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
  const lesson = release.lessons[rootIndex];
  const pedagogy = lesson.pedagogy;
  if (pedagogy && session.nodeId === session.rootId && session.phase === 'playing') {
    const proofMode = pedagogy.calculationRequired ? '棋理首選會失誤，必須精算' : '棋理首選獲精算支持';
    addParagraph(
      body,
      `本題標籤：${difficultyLabel(pedagogy.difficulty)} · ${pedagogy.legalMoveCount} 個合法手 · ${pedagogy.balancedMoveCount} 個平衡解 · ${proofMode}。`,
      pedagogy.calculationRequired ? 'warning-note' : 'takeaway'
    );
  }

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
    elements['lesson-title'].textContent = '第二步：讓適用棋理共同排序';
    addParagraph(body, `棋理庫共有 ${analysis.theory.catalogSize} 條規則；本盤有 ${analysis.theory.activeTheories.length} 條能區分候選。先依角落、手數、行動力、奇偶、前沿與穩定性綜合留下 ${names(analysis.theory.shortlist)}。`);
    addList(body, analysis.theory.shortlist, (fact) => `${fact.name}：棋理分 ${fact.theoryScore.toFixed(1)}。${theoryReasons(fact) || '各項訊號接近，暫不能靠棋理區分。'}`);
    addParagraph(body, '這是未看精算答案的候選排序，只負責縮小閱讀範圍；不把分數最高直接當成證明。', 'warning-note');
  } else if (lessonStage === 2) {
    const primary = analysis.theory.primaryTheory;
    elements['lesson-title'].textContent = primary ? `第三步：本盤主題—${primary.title}` : '第三步：本盤需要直接計算';
    if (primary) {
      addParagraph(body, primary.principle);
      addParagraph(body, `限制：${primary.caveat}`, 'warning-note');
      const signals = analysis.facts
        .map((fact) => ({ fact, signal: fact.theorySignals.find((item) => item.id === primary.id) }))
        .filter((item) => item.signal)
        .sort((left, right) => right.signal.contribution - left.signal.contribution)
        .slice(0, 5);
      addList(body, signals, ({ fact, signal }) => `${fact.name}：${signal.observation}`);
      const supporting = analysis.theory.explanatoryTheories.slice(1, 4);
      if (supporting.length > 0) addParagraph(body, `還要一起檢查：${supporting.map((theory) => theory.title).join('、')}。`, 'takeaway');
    } else {
      addParagraph(body, '現有棋理沒有一條能穩定區分平衡手與失敗手；保留候選並交給完整搜尋。', 'warning-note');
    }
  } else {
    elements['lesson-title'].textContent = '第四步：完整搜尋負責最後證明';
    addParagraph(body, `人類原則把 ${analysis.legalCount} 手縮成候選，但不能單獨證明答案。精算結果：${names(analysis.balanced)} 能維持和局，其餘 ${analysis.failures.length} 手在雙方無失誤下必敗。`);
    if (analysis.theory.heuristicAgreement) {
      addParagraph(body, `本盤棋理第一候選 ${analysis.theory.ranked[0].name} 通過精算；若有多條平衡路線，依棋理分只決定教學順序，不刪除其他正解。`, 'takeaway');
    } else {
      addParagraph(body, `本盤棋理第一候選 ${analysis.theory.ranked[0].name} 未通過精算，因此撤銷推薦；改由已證明集合中的 ${names(analysis.theory.verifiedRanked)} 繼續。這類盤面會標記為「必須計算」。`, 'warning-note');
    }
    renderExactTable(analysis, body);
    addParagraph(body, '金色落點是資料中所有可繼續維持和局的選擇；這份資料目前證明勝負類別，不虛構未保存的最終子差。', 'takeaway');
  }
}

function renderBoard(analysis) {
  const legal = new Set(session.phase === 'playing' ? session.legalDisplayMoves() : []);
  const balanced = new Set(analysis && (lessonStage === 3 || session.phase === 'review') ? analysis.balanced.map((fact) => fact.displaySquare) : []);
  const candidates = new Set(analysis && lessonStage >= 1 && lessonStage < 3 ? analysis.theory.shortlist.map((fact) => fact.displaySquare) : []);
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
      button.addEventListener('click', () => play(square).catch(showFatal));
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
  try {
    await progressStore.saveSession(lastSnapshot);
    await recordEvent(LearningEventType.LESSON_COMPLETED, { details: { moves: lastSnapshot.history.length } });
  } catch (error) { console.warn('Progress save failed', error); }
}

async function play(square) {
  const before = analyzeTurn(session);
  const fact = before.facts.find((candidate) => candidate.displaySquare === square);
  const movingColor = before.color;
  const attemptedNode = session.nodeId;
  const elapsed = Math.round(performance.now() - nodeStartedAt);
  const result = session.playStudentMove(square);
  if (fact) {
    await recordEvent(LearningEventType.MOVE_ATTEMPTED, {
      positionId: String(attemptedNode),
      nodeId: attemptedNode,
      side: movingColor,
      move: fact.name,
      outcome: result.reason === 'failure' ? 'failure' : 'value_preserving',
      hintLevel: lessonStage,
      latencyMs: elapsed,
      criticality: before.balanced.length === 1 ? 1.5 : 1,
      transfer: Boolean(projection.completedLessons.find((item) => item.lessonId === release.lessons[rootIndex].id)),
      details: { legalMoveCount: before.legalCount, balancedMoveCount: before.balanced.length }
    });
  }
  if (result.reason === 'failure') {
    lessonStage = 3;
    lastResult = `${movingColor} ${fact?.name || squareName(square)}：完整搜尋判定必敗，盤面保留供你比較。`;
    render();
    showFailureDialog(before, fact);
    return;
  }
  if (!result.accepted) return;
  lastResult = `${movingColor} ${fact.name}：維持和局；翻 ${fact.flips} 子，下一方原有 ${fact.opponentMobility} 個合法選擇。`;
  lessonStage = 0;
  nodeStartedAt = performance.now();
  if (session.phase === 'terminal') {
    finish();
    return;
  }
  render();
}

async function startRoot(index) {
  closeFailureDialog();
  const requested = Math.max(0, Math.min(release.lessonCount - 1, Number(index) || 0));
  const selected = requested;
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
  sessionId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${rootIndex}`;
  lastSnapshot = null;
  lastResult = '';
  lessonStage = 0;
  nodeStartedAt = performance.now();
  elements.evidence.textContent = `✓ SHA-256 已驗證 · ${release.lessonCount} 題 · 已載入 ${repository.loadedShardCount(release)}/${release.shards.length} 分片（${(repository.loadedBytes(release) / 1048576).toFixed(1)} MB）`;
  populateRootSelect();
  render();
  await recordEvent(LearningEventType.LESSON_STARTED, { nodeId: session.nodeId, hintLevel: 0 });
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
  if (lessonStage > 0) recordEvent(LearningEventType.HINT_USED, { nodeId: session.nodeId, hintLevel: lessonStage }).catch(console.warn);
});
elements.reveal.addEventListener('click', () => {
  lessonStage = 3;
  render();
  recordEvent(LearningEventType.HINT_USED, { nodeId: session.nodeId, hintLevel: 3, details: { directReveal: true } }).catch(console.warn);
});
function retryFailure() {
  closeFailureDialog();
  session.retry();
  lessonStage = 0;
  lastResult = '盤面未改變。重新從空格區域開始判斷。';
  render();
}
elements.retry.addEventListener('click', retryFailure);
elements['failure-dialog-retry'].addEventListener('click', retryFailure);
elements['failure-dialog-close'].addEventListener('click', closeFailureDialog);
elements.next.addEventListener('click', () => startRoot(rootIndex + 1).catch(showFatal));
elements.replay.addEventListener('click', () => replay().catch(showFatal));
elements['root-select'].addEventListener('change', () => startRoot(Number(elements['root-select'].value)).catch(showFatal));
document.querySelectorAll('[data-view-target]').forEach((button) => {
  button.addEventListener('click', () => switchView(button.dataset.viewTarget));
});
window.addEventListener('hashchange', () => switchView(location.hash.slice(1), { updateHash: false }));

elements['start-daily'].addEventListener('click', () => {
  const first = dailyPlan[0];
  if (!first) return;
  switchView('practice');
  startRoot(first.index).catch(showFatal);
});
elements['continue-course'].addEventListener('click', () => {
  switchView('practice');
  startRoot(curriculum.unlockedThrough).catch(showFatal);
});
elements['save-profile'].addEventListener('click', async () => {
  profile = await progressStore.updateProfile({
    displayName: elements['profile-name'].value.trim(),
    experience: elements['profile-experience'].value,
    dailyMinutes: Number(elements['profile-minutes'].value)
  });
  renderLearningShell();
  elements['sync-status'].textContent = '設定已儲存在此裝置。';
});
elements['onboarding-start'].addEventListener('click', async () => {
  profile = await progressStore.updateProfile({
    experience: elements['onboarding-experience'].value,
    dailyMinutes: Number(elements['onboarding-minutes'].value),
    onboardedAt: new Date().toISOString()
  });
  elements['onboarding-dialog'].close();
  renderLearningShell();
});
elements['auth-action'].addEventListener('click', async () => {
  if (!authProvider || authProvider.kind !== 'supabase') return;
  elements['auth-action'].disabled = true;
  try {
    identity = await authProvider.getIdentity();
    if (identity.authenticated) await authProvider.signOut();
    else await authProvider.signIn();
    await renderAccountStatus();
  } catch (error) {
    elements['sync-status'].textContent = `登入作業失敗：${error.message}`;
  } finally {
    elements['auth-action'].disabled = false;
  }
});
elements['sync-action'].addEventListener('click', async () => {
  elements['sync-action'].disabled = true;
  elements['sync-status'].textContent = '正在合併學習事件…';
  try {
    await syncEngine.run();
    await refreshLearningState();
    elements['sync-status'].textContent = '同步完成，本機與雲端事件已合併。';
  } catch (error) {
    elements['sync-status'].textContent = `同步失敗，本機紀錄不受影響：${error.message}`;
  } finally {
    await renderAccountStatus();
  }
});
elements['export-data'].addEventListener('click', async () => {
  const data = await progressStore.exportData();
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `othello-learning-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

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
    const lesson = release.lessons[index];
    const level = lesson.pedagogy ? ` · ${difficultyLabel(lesson.pedagogy.difficulty)}` : '';
    const title = lesson.title ? ` · ${lesson.title}` : '';
    const status = isLessonCompleted(curriculum, index)
      ? ' · ✓ 已完成'
      : index === curriculum.unlockedThrough ? ' · 引導下一關' : ' · 自由練習';
    option.textContent = `第 ${String(index + 1).padStart(3, '0')} 題${level}${title}${status}`;
    elements['root-select'].append(option);
  }
  elements['root-select'].value = String(rootIndex);
  elements['root-select'].disabled = false;
  elements['question-progress'].textContent = curriculum.completedCount === release.lessonCount
    ? `全部 ${release.lessonCount} 題完成，可自由複習`
    : `已完成 ${curriculum.completedCount}/${release.lessonCount} · 下一關：第 ${String(curriculum.unlockedThrough + 1).padStart(3, '0')} 題`;
}

async function migrateLegacyCurriculum() {
  if (await progressStore.getSyncState('legacyCurriculumMigrated', false)) return;
  const alreadyCompleted = new Set(learningEvents.filter((event) => event.eventType === LearningEventType.LESSON_COMPLETED).map((event) => event.lessonId));
  const records = Object.entries(curriculum.completed).filter(([lessonId]) => !alreadyCompleted.has(lessonId));
  if (records.length) {
    let sequence = Number(profile.clientSeq || 0);
    const migrated = records.map(([lessonId, record]) => createLearningEvent({
      eventType: LearningEventType.LESSON_COMPLETED,
      profileId: profile.id,
      deviceId: profile.installationId,
      clientSeq: ++sequence,
      occurredAt: record.lastCompletedAt || record.firstCompletedAt || new Date().toISOString(),
      datasetId: release.datasetId,
      lessonId,
      details: { moves: record.moves || 0, migratedFrom: 'curriculum-v2' }
    }));
    await progressStore.appendEvents(migrated);
    profile = await progressStore.updateProfile({ clientSeq: sequence });
  }
  await progressStore.setSyncState('legacyCurriculumMigrated', true);
}

async function main() {
  profile = await progressStore.initialize();
  release = await repository.loadRelease('./data/release-manifest.json');
  curriculum = loadCurriculum(localStorage, release.lessons);
  learningEvents = await progressStore.listEvents();
  await migrateLegacyCurriculum();
  await refreshLearningState();
  authProvider = createAuthProvider(appConfig, profile);
  syncEngine = new SyncEngine({
    store: progressStore,
    authProvider,
    adapter: authProvider.kind === 'supabase' && appConfig.sync.enabled ? new SupabaseEventSyncAdapter(authProvider) : null,
    onEventsChanged: refreshLearningState
  });
  await authProvider.subscribe(() => renderAccountStatus().catch(console.warn));
  populateRootSelect();
  await startRoot(Number.isFinite(rootIndex) ? rootIndex : 0);
  switchView(location.hash.slice(1) || 'today', { updateHash: false });
  renderLearningShell();
  if (!profile.onboardedAt && typeof elements['onboarding-dialog'].showModal === 'function') elements['onboarding-dialog'].showModal();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

main().catch(showFatal);
