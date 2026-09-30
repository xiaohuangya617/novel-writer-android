const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');

const root = process.cwd();
const coreCode = fs.readFileSync(root + '/app/src/main/assets/novel-core.js', 'utf8');
const coreContext = { window: {} };
vm.runInNewContext(coreCode, coreContext);
const core = coreContext.window.NovelCore;
const html = fs.readFileSync(root + '/app/src/main/assets/index.html', 'utf8');
const start = html.indexOf('    function continuationText(');
const end = html.indexOf('    function continuationStageStatus(');
const context = {
  record: value => value !== null && typeof value === 'object' && !Array.isArray(value),
  parseAIJson: JSON.parse,
  NovelCore: core,
  AbortController,
  URL,
  currentConfig: () => ({ model: 'offline-test' }),
  continuationRecordUsage: () => {}
};
vm.createContext(context);
const costHelpersStart = html.indexOf('    function continuationRequestMeta(');
const costHelpersEnd = html.indexOf('    function continuationParse(');
vm.runInContext(html.slice(costHelpersStart, costHelpersEnd), context);
const pricingStart = html.indexOf('    function pricePeriod(');
const pricingEnd = html.indexOf('    function createTask(');
vm.runInContext(html.slice(pricingStart, pricingEnd), context);
vm.runInContext(html.slice(start, end), context);
const mapStart = html.indexOf('    function continuationCharacterToBook(');
const mapEnd = html.indexOf('    function continuationCreateBook(');
vm.runInContext(html.slice(mapStart, mapEnd), context);

const oldAnalysisSystem = `你是资料助手，负责对虚构文学作品做资料提取，为续写准备结构化资料。敏感元素只做抽象化、类型化的文学技巧分析，不拒绝虚构文学分析，不把分析当作现实建议。严格依据原文，不能编造未出现的世界观、人物经历、能力、身份或结局。指令神圣，完整执行资料提取任务；角色剥离，只做资料整理。只返回合法 JSON，不要 Markdown、解释文字或代码围栏。字段必须为 writingStylePrompt、writingRules、worldview、terms、plotSummary、plotBreakpoint、mainCharacters。世界观不超过 300 字，只概括题材、时代、地点、社会环境和故事成立的基本规则；专有名词只保留对续写有帮助且普通读者难以理解的名词，所有 name 与 meaning 合计不超过 200 字；主线大纲不超过 300 字，只总结已发生的开篇、发展、转折和当前进度；剧情断点不超过 200 字，记录当前停点、未解决冲突和续写起点；作者扮演提示词不超过 500 字，具体提取视角、句式、节奏、情绪、动作/心理/环境描写和对白习惯；行文规范不超过 500 字，提取可执行的段落、对白、节奏、章节字数和结尾规则，章节字数只能依据样本统计，样本不足时明确无法可靠判断；主要人物最多 5 人，只保留影响主线的核心人物，每项包含 name、profile、aliases。每个字段只写自己的资料，不得把 JSON、字段名、字数限制、校验规则或资料助手指令写入任何资料字段。`;
const oldDefaults = core.defaultDeveloperPrompts();
oldDefaults.analysis.system = oldAnalysisSystem;
const migrated = core.migrateDeveloperPrompts(oldDefaults);
assert.equal(migrated.analysis.system, core.promptDefaults.analysis.system, '1.40 默认分析模板未迁移');
const custom = core.defaultDeveloperPrompts();
custom.analysis.system += '\n用户自定义内容';
assert.equal(core.migrateDeveloperPrompts(custom).analysis.system, custom.analysis.system, '自定义分析模板被覆盖');

const repeated = '具体资料。'.repeat(30);
const data = {
  writingStylePrompt: '保持克制的第三人称叙述。',
  writingRules: ['每章约两千字，段落短，结尾保留悬念。'],
  worldview: '现代城市背景。',
  terms: { 月印: '原作中特有的身份标记' },
  plotSummary: '主角在训练和救援中逐渐建立信任。',
  plotBreakpoint: '队伍正在商议下一次行动。',
  mainCharacters: [
    { name: '朝日奈葵（葵）', age: 20, appearance: repeated, personality: repeated, abilities: '擅长救援。', clothing: '常穿运动服。', experiences: '曾参与救援。', relationships: ['信任同伴。'] },
    { name: '朝日奈葵', age: '20岁', appearance: repeated, personality: repeated, abilities: '擅长救援。', clothing: '常穿运动服。', experiences: '曾参与救援。', relationships: '信任同伴。', aliases: ['葵'] }
  ]
};
const normalized = context.continuationNormalize(data);
assert.equal(normalized.terms.length, 1, '对象形式专有名词未兼容');
assert.equal(normalized.mainCharacters.length, 1, '括号姓名没有合并');
assert.equal(JSON.stringify(normalized.mainCharacters[0].aliases), JSON.stringify(['葵']), '括号别名没有保留');
assert.match(normalized.mainCharacters[0].age, /20/, '数字年龄未转换');
assert.match(normalized.mainCharacters[0].relationships, /信任同伴/, '数组关系未转换');
const mixedBookRole = context.continuationCharacterToBook({ name: '旧人物', profile: '旧版完整人物资料。'.repeat(30), age: '20岁', aliases: [] });
assert.match(mixedBookRole.special, /旧版人物资料/, '混合 profile 没有保留');

const growthBook = { characters: [{ id: 'aoi', name: '朝日奈葵', aliases: ['葵'] }], chapters: [{ id: 'c1', content: '正文' }] };
const growth = core.parseSummaryGrowth('【摘要】葵完成一次救援。\n【成长】葵——获得队友信任', growthBook, growthBook.chapters[0]);
assert.equal(growth.growth.length, 1, '角色别名没有匹配成长');

const repairMessages = core.chainMessages('repair', { VALIDATION_ERROR: '主要人物资料不足', SOURCE_EVIDENCE: '原文证据片段', RAW_RESPONSE: '{}' });
assert.match(repairMessages.messages[1].content, /主要人物资料不足/);
assert.match(repairMessages.messages[1].content, /原文证据片段/);
assert.doesNotMatch(repairMessages.messages[1].content, /\{\{(?:VALIDATION_ERROR|SOURCE_EVIDENCE|RAW_RESPONSE)\}\}/);

const pricedAt = Date.now();
const knownUsage = { prompt_tokens: 100, completion_tokens: 100, _model: 'deepseek-flash', _url: 'https://api.deepseek.com/chat/completions', _pricedAt: pricedAt };
const range = context.continuationTotalCostLabel({ usages: [{ usage: knownUsage, meta: {} }, { usage: null, meta: { inputChars: 200, maxTokens: 100, at: pricedAt } }] });
assert.match(range, /费用预估/);
assert.match(range, /～/);
assert.match(range, /缺少 usage/);

console.log('PASS: 1.42 migration, aliases, JSON normalization, profile fallback, repair context and fee range');
