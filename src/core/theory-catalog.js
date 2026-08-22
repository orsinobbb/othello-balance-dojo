function average(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export const THEORY_CATALOG_VERSION = '1.0.0';

const THEORY_RULES = [
  { id: 'take-corner', family: 'corner', title: '取得角落', weight: 8, direction: 1, measure: (fact) => Number(fact.category === '角落') },
  { id: 'deny-corner', family: 'corner', title: '避免立即送角', weight: 8, direction: -1, measure: (fact) => fact.openedCornerCount },
  { id: 'forced-pass', family: 'tempo', title: '逼迫對手停著', weight: 7, direction: 1, measure: (fact) => Number(fact.forcedPass) },
  { id: 'shared-singleton', family: 'tempo', title: '搶走雙方共用單格', weight: 6, direction: 1, measure: (fact) => Number(fact.sharedSingleton) },
  { id: 'empty-x-risk', family: 'corner', title: '空角旁 X 格風險', weight: 5, direction: -1, measure: (fact) => Number(fact.cornerRisk === 'X-empty') },
  { id: 'empty-c-risk', family: 'corner', title: '空角旁 C 格風險', weight: 4, direction: -1, measure: (fact) => Number(fact.cornerRisk === 'C-empty') },
  { id: 'opponent-mobility', family: 'mobility', title: '壓低對手實際行動力', weight: 5, direction: -1, measure: (fact) => fact.opponentMobility },
  { id: 'reply-resilience', family: 'mobility', title: '承受對手最佳回應', weight: 3, direction: 1, measure: (fact) => fact.worstReplyMobility },
  { id: 'avoid-reply-pass', family: 'tempo', title: '避免被對手反逼停', weight: 5, direction: -1, measure: (fact) => Number(fact.replyCanForcePass) },
  { id: 'frontier-discipline', family: 'mobility', title: '減少新增前沿子', weight: 2.5, direction: -1, measure: (fact) => fact.frontierDelta },
  { id: 'potential-mobility', family: 'mobility', title: '壓低對手潛在行動力', weight: 2.5, direction: -1, measure: (fact) => fact.opponentPotentialMobility },
  { id: 'anchored-edge', family: 'stability', title: '增加角落錨定邊線', weight: 3, direction: 1, measure: (fact) => fact.anchoredEdgeGain },
  { id: 'odd-region', family: 'parity', title: '優先奇數空區的手數機會', weight: 1.5, direction: 1, measure: (fact) => Number(fact.regionSize % 2 === 1) },
  { id: 'preserve-large-region', family: 'parity', title: '延後打開最大空區', weight: 2.5, direction: -1, measure: (fact, context) => Number(context.largestRegion >= 5 && fact.regionSize === context.largestRegion) },
  { id: 'flip-economy', family: 'frontier', title: '少翻子保留彈性', weight: 1, direction: -1, measure: (fact) => fact.flips }
];

const THEORY_GUIDE = {
  'take-corner': { principle: '角落不會再被翻，通常能建立穩定邊線。', caveat: '取得角落仍可能失去手數；終盤不能只看角。', explain: (fact) => `${fact.name} 直接取得角落。` },
  'deny-corner': { principle: '先檢查落子後是否立即給對手角落。', caveat: '送角有時是換取終盤手數的必要代價。', explain: (fact) => `${fact.name} 後讓對手立即多出 ${fact.openedCornerCount} 個角落選項。` },
  'forced-pass': { principle: '逼停能讓自己連走並改變空區最後一手歸屬。', caveat: '連走也可能迫使自己先打開不利區域。', explain: (fact) => `${fact.name} 後對手沒有合法手。` },
  'shared-singleton': { principle: '雙方共用的孤立單格是一個會被搶走的手數資源。', caveat: '搶單格的代價仍須與送角、區域次序一起算。', explain: (fact) => `${fact.name} 是雙方現在都能使用的孤立單格。` },
  'empty-x-risk': { principle: '角落仍空時，X 格常讓對手取得角。', caveat: '角已屬己方或有強制手順時，X 格風險會改變。', explain: (fact) => `${fact.name} 是空角旁的 X 格。` },
  'empty-c-risk': { principle: '角落仍空時，C 格要檢查是否沿邊送角。', caveat: 'C 格不是固定壞格，邊線控制與手順可使它安全。', explain: (fact) => `${fact.name} 是空角旁的 C 格。` },
  'opponent-mobility': { principle: '減少對手合法手，較容易控制回應。', caveat: '合法手少不等於局面好，唯一回應也可能正是妙手。', explain: (fact) => `${fact.name} 後對手有 ${fact.opponentMobility} 個合法手。` },
  'reply-resilience': { principle: '用對手最強的一手回覆測試候選，而非只看平均。', caveat: '這裡只看兩層行動力，仍不是終局證明。', explain: (fact) => `${fact.name} 面對最壓迫的下一手後，己方仍有 ${fact.worstReplyMobility} 個合法手。` },
  'avoid-reply-pass': { principle: '檢查對手是否能用下一手把自己逼停。', caveat: '被逼停有時能避開壞區，不能一律判壞。', explain: (fact) => `${fact.name} 後存在一個回應可讓己方停著。` },
  'frontier-discipline': { principle: '鄰接空格的前沿子較容易被利用，通常少增加較好。', caveat: '終盤局部強制交換可能比前沿數更重要。', explain: (fact) => `${fact.name} 使己方前沿子變化 ${fact.frontierDelta >= 0 ? '+' : ''}${fact.frontierDelta}。` },
  'potential-mobility': { principle: '空格鄰接的對方棋越多，未來可形成的行動力通常越高。', caveat: '潛在行動力是結構訊號，不保證下一手真的合法。', explain: (fact) => `${fact.name} 後對手有 ${fact.opponentPotentialMobility} 個潛在行動格。` },
  'anchored-edge': { principle: '由己方角落連續延伸的邊子可視為可靠穩定來源。', caveat: '這只計算角落錨定邊線，不等於完整穩定子演算法。', explain: (fact) => `${fact.name} 使角落錨定邊子變化 ${fact.anchoredEdgeGain >= 0 ? '+' : ''}${fact.anchoredEdgeGain}。` },
  'odd-region': { principle: '奇數空區常提供取得區域最後一手的機會。', caveat: '通行權、逼停與跨區落子都可能反轉單純奇偶。', explain: (fact) => `${fact.name} 位於 ${fact.regionSize} 格奇數空區。` },
  'preserve-large-region': { principle: '先保留大空區，避免過早給對手大量分支。', caveat: '若大區內有強制手或必須先手進入，就不能機械延後。', explain: (fact) => `${fact.name} 會立即進入目前最大的 ${fact.regionSize} 格空區。` },
  'flip-economy': { principle: '少翻子通常能減少前沿暴露並保留彈性。', caveat: '終盤勝負看最後子差與手順，少翻不是目的本身。', explain: (fact) => `${fact.name} 立即翻 ${fact.flips} 子。` }
};

export const THEORY_CATALOG = Object.freeze(THEORY_RULES.map((rule) =>
  Object.freeze({ ...rule, ...THEORY_GUIDE[rule.id] })));

export function rankByTheory(facts, context) {
  const scoreBySquare = new Map(facts.map((fact) => [fact.square, 0]));
  const signalsBySquare = new Map(facts.map((fact) => [fact.square, []]));
  const activeTheories = [];

  for (const theory of THEORY_CATALOG) {
    const values = facts.map((fact) => theory.measure(fact, context));
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    if (minimum === maximum) continue;

    const contributions = values.map((value) => {
      const preferred = theory.direction > 0
        ? (value - minimum) / (maximum - minimum)
        : (maximum - value) / (maximum - minimum);
      return preferred * theory.weight;
    });

    facts.forEach((fact, index) => {
      scoreBySquare.set(fact.square, scoreBySquare.get(fact.square) + contributions[index]);
      signalsBySquare.get(fact.square).push({
        id: theory.id,
        family: theory.family,
        title: theory.title,
        principle: theory.principle,
        caveat: theory.caveat,
        observation: theory.explain(fact, context),
        value: values[index],
        contribution: contributions[index]
      });
    });

    const balancedContributions = contributions.filter((_, index) => facts[index].balanced);
    const failedContributions = contributions.filter((_, index) => !facts[index].balanced);
    activeTheories.push({
      id: theory.id,
      family: theory.family,
      title: theory.title,
      principle: theory.principle,
      caveat: theory.caveat,
      weight: theory.weight,
      contrast: average(balancedContributions) - average(failedContributions)
    });
  }

  for (const fact of facts) {
    fact.theoryScore = scoreBySquare.get(fact.square);
    fact.theorySignals = signalsBySquare.get(fact.square)
      .sort((left, right) => right.contribution - left.contribution || left.id.localeCompare(right.id));
  }

  const ranked = [...facts].sort((left, right) =>
    right.theoryScore - left.theoryScore
    || left.opponentMobility - right.opponentMobility
    || left.flips - right.flips
    || left.displaySquare - right.displaySquare);
  const positiveExplanations = activeTheories
    .filter((theory) => theory.contrast > 0)
    .sort((left, right) => right.contrast - left.contrast || right.weight - left.weight);
  const scoreGap = ranked.length > 1 ? ranked[0].theoryScore - ranked[1].theoryScore : ranked[0]?.theoryScore || 0;
  const verifiedRanked = ranked.filter((fact) => fact.balanced);
  const heuristicAgreement = Boolean(ranked[0]?.balanced);

  return {
    catalogVersion: THEORY_CATALOG_VERSION,
    catalogSize: THEORY_CATALOG.length,
    ranked,
    shortlist: ranked.slice(0, Math.min(4, ranked.length)),
    verifiedRanked,
    selected: verifiedRanked[0] || null,
    activeTheories: activeTheories.sort((left, right) => right.weight - left.weight),
    explanatoryTheories: positiveExplanations,
    primaryTheory: positiveExplanations[0] || null,
    scoreGap,
    blindStrongRecommendation: scoreGap >= 3,
    heuristicAgreement,
    calculationRequired: !heuristicAgreement
  };
}
