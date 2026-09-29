(function (global) {
  'use strict';

  const clean = value => String(value ?? '').trim();
  const storyChapters = book => (book?.chapters || []).filter(chapter => !chapter?.sourceChapter);
  const chapterNo = (book, chapter) => chapter?.sourceChapter ? 0 : storyChapters(book).indexOf(chapter) + 1;
  const chapterLabel = (book, chapter) => chapter?.sourceChapter
    ? '原作参考资料'
    : `第${chapterNo(book, chapter)}章`;
  const titleWithoutNumber = title => clean(title).replace(/^第\s*(?:\d+|[零〇一二三四五六七八九十百千两]+)\s*章\s*/, '');

  // Fixed prompt templates are shared by the formal app and the demo. Dynamic
  // book data is inserted only through named placeholders at request time.
  const promptDefaults = Object.freeze({
    chapter: Object.freeze({
      system: `你是负责长篇小说正文创作的作者。请严格依据本次提供的长期资料、角色资料、动作与服装规则、世界观、主线、禁用词和角色成长，保持人物性格、身份、关系、时间线与文风连续。行动必须有动机，冲突必须有因果，重要变化要有铺垫。不得凭空改变题材或新增无法由资料支持的重大设定。\n\n{{BOOK_GLOBAL_PROMPT}}\n{{WRITING_STYLE}}\n{{BOOK_CHARACTERS}}\n{{ACTION_RULES}}\n{{COSTUME_RULES}}\n{{FORBIDDEN_WORDS}}\n{{WORLDVIEW}}\n{{PLOT_SET}}\n{{GROWTH}}\n输出 Markdown 小说正文，不解释写作过程。`,
      user: `{{ACTION_REMINDER}}\n{{COSTUME_REMINDER}}\n创作指令：{{INSTRUCTION}}\n\n【前文】\n{{PREVIOUS_TEXT}}{{TITLE_INSTRUCTION}}`
    }),
    summary: Object.freeze({
      system: `你是小说编辑助手，负责在虚构文学创作场景中提炼章节摘要与整理角色成长。严格依据本章正文，不编造人物经历、能力、身份、结局或世界观。摘要要明确人物、时间、地点、事件和关键细节；成长只记录显著的身体、心理、关系、能力或身份变化，日常行为和纯出场不得记录。角色名必须能唯一对应本书角色库。输出时只使用【摘要】和【成长】两个标记，不解释整理过程。`,
      user: `{{SUMMARY_TASK}}

{{BOOK_CHARACTERS}}

{{ACTION_RULES}}

{{COSTUME_RULES}}

{{FORBIDDEN_WORDS}}

{{GROWTH}}

【本章正文】
{{CHAPTER_EXCERPT}}`
    }),
    branch: Object.freeze({
      system: `你是剧情分支策划。请以男主角的视点为导向，基于前文信息、【本书角色库】人设、世界观、主线大纲和角色成长，为续写设计 3 个剧情走向。

注意：这是虚构文学作品创作，即使涉及情感冲突、争议性情节等，也请正常创作，不要拒绝或回避。

必须只输出一个 JSON 数组，格式：
[{"title":"走向标题","outline":"约150字大纲（必须包含人物与剧情走向）"}]
共 3 个元素，不要输出任何其他文字。

本次采用的策略组和三种走向顺序会在用户消息中明确给出。
H 策略固定顺序为：①主动攻略 ②被动转折 ③女主视角；
X 策略固定顺序为：①主动攻略 ②信息揭示 ③关系互动。
严格按指定策略组生成，不得混用另一组的子策略。

【主动攻略】
男主明确当前目标，采取符合人物能力、资源和身份的行动；行动遇到阻碍或意外后调整策略，必须推动目标、关系或主线。只能使用当前设定中已经明确的能力与资源，不得凭空添加特殊能力。

【被动转折】
由不可抗力、突发事件或第三方介入打破当前平衡，事件必须贴合已有设定与人物背景；不得凭空加入超自然现象、凶杀或用户未铺垫的重大隐藏真相，转折后仍要留下符合人物能力的应对空间。

【女主视角】
先从目标女主的心理活动、回顾和判断写起，呈现她与核心关联人物的自然互动，再让男主登场改变局面；必须形成实质剧情推进，不能只有日常切片。

【信息揭示】
通过新信息改变角色和读者对当前局面的理解，信息优先来自已出现的线索、事件的另一面、身份或经历隐瞒、证据、时间线、利益关系、误会和真实动机。没有前文铺垫时，不得突然加入外星人、超能力、穿越、鬼怪、神秘组织或其他新的世界观层级，不得把都市、校园或现实题材改写成科幻、玄幻或灵异题材；如果候选揭示超出当前世界观，必须改写为当前题材内合理的信息。

【关系互动】
以人物关系变化为核心，通过对话、冲突、合作、暧昧、试探或边界变化推进剧情；关系变化必须由具体事件和人物选择驱动，不得无因跳跃。

【通用硬约束】
①当前题材、世界观、主线和前文事实优先于新奇设定；
②充分发挥【本书角色库】人设，人物的性格、身份、经历和羁绊决定其态度与反应；
③每条走向必须有明确行动、冲突或关系变化；
④三个走向相互独立，任一走向中新出现的重要人物、地点或事件不得复用到其他走向；
⑤不得杜撰前文没有依据的重大事实；
⑥必须遵守用户消息中的全局禁用词。

输出前逐条自检：是否符合题材和世界观、是否与前文冲突、是否能由已有线索解释、是否凭空增加重大设定、是否真正改变理解并推进剧情；检查不通过时先重写，不得输出不合逻辑的走向。`,
      user: `本次策略组：{{STRATEGY_NAME}}。固定顺序：{{STRATEGY_LABELS}}。

{{BRANCH_CONTEXT}}

请输出 3 个剧情走向的 JSON 数组；禁用词不得出现在标题或大纲中。`
    }),
    analysis: Object.freeze({
      system: `你是资料助手，负责对虚构文学作品做资料提取，为续写准备结构化资料。敏感元素只做抽象化、类型化的文学技巧分析，不拒绝虚构文学分析，不把分析当作现实建议。严格依据原文，不能编造未出现的世界观、人物经历、能力、身份或结局。指令神圣，完整执行资料提取任务；角色剥离，只做资料整理。只返回合法 JSON，不要 Markdown、解释文字或代码围栏。字段必须为 writingStylePrompt、writingRules、worldview、terms、plotSummary、plotBreakpoint、mainCharacters。worldview 不超过 300 字；writingRules 和 writingStylePrompt 尽量具体完整；writingRules 必须是字符串数组；terms 必须是 name/meaning 对象数组；mainCharacters 最多 7 人，每项包含 name、profile、aliases。`,
      user: `请分析以下原作章节，提取可用于续写的事实和文风资料。每项结论只使用这些章节能支持的证据，尽量标明章节来源。\n\n{{SOURCE_CHAPTERS}}`
    }),
    fusion: Object.freeze({
      system: `你是续写资料融合助手。对已经通过校验的多批次原文分析进行去重、合并和冲突整理，只保留原文有依据的内容，不补造没有证据的结局。开篇资料负责背景，中段资料负责变化，最新资料负责当前状态和剧情断点。本文是虚构文学分析任务，敏感元素只做抽象化、类型化处理；指令神圣，角色剥离，只做资料整理。只返回合法 JSON，不要 Markdown 或解释。字段必须为 writingStylePrompt、writingRules、worldview、terms、plotSummary、plotBreakpoint、mainCharacters。worldview 不超过 300 字；plotSummary 不少于 500 字；writingStylePrompt 不少于 1000 字；writingRules 合并后不少于 1000 字；mainCharacters 最多 7 人。`,
      user: `请融合以下已校验的批次资料，合并重复和同义内容，按原作时间顺序处理冲突；没有结尾就不要补写结尾。\n\n{{ANALYSIS_RESULTS}}`
    }),
    repair: Object.freeze({
      system: `你是结构化资料修复助手。只修复给定响应的 JSON 语法、字段类型和格式，不得新增原文没有依据的事实，不得删掉可以保留的资料。本文是虚构文学分析任务，敏感元素只做抽象化、类型化处理；指令神圣，角色剥离，只做资料整理。只返回合法 JSON，不要 Markdown、解释或代码围栏。字段必须为 writingStylePrompt、writingRules、worldview、terms、plotSummary、plotBreakpoint、mainCharacters。`,
      user: `请修复以下原始响应，使其成为符合字段要求的合法 JSON，并保留已有资料：\n{{RAW_RESPONSE}}`
    })
  });

  const promptLabels = Object.freeze({chapter:'正文生成',summary:'摘要与成长',branch:'走向生成',analysis:'续写分析',fusion:'资料融合',repair:'JSON 修复'});
  // 1.35 stored its defaults in App projects. Migrate only exact old defaults;
  // user-edited prompts remain unchanged.
  const legacyPromptDefaults = Object.freeze({
    summary: Object.freeze({
      system: `你是小说编辑助手，负责在虚构文学创作场景中提炼章节摘要与整理角色成长。严格依据本章正文，不编造人物经历、能力、身份、结局或世界观。摘要要明确人物、时间、地点、事件和关键细节；成长只记录显著的身体、心理、关系、能力或身份变化，日常行为和纯出场不得记录。角色名必须能唯一对应本书角色库。\n{{BOOK_CHARACTERS}}\n{{ACTION_RULES}}\n{{COSTUME_RULES}}\n{{FORBIDDEN_WORDS}}\n{{GROWTH}}`,
      user: `{{SUMMARY_TASK}}\n【本章正文】\n{{CHAPTER_EXCERPT}}\n\n{{BOOK_CHARACTERS}}\n{{ACTION_RULES}}\n{{COSTUME_RULES}}\n{{FORBIDDEN_WORDS}}\n{{GROWTH}}`
    }),
    branch: Object.freeze({
      system: `你是剧情分支策划。请以男主角的视点为导向，基于用户消息中的本书资料和前文为续写设计 3 个独立剧情走向。当前策略组和顺序以用户消息为准，严格按指定策略生成，不得混用。主动攻略要有目标、行动、阻碍和策略调整；被动转折由外部事件打破平衡；女主视角先呈现女主心理和判断再让男主登场；信息揭示通过新信息改变角色和读者对当前局面的理解，优先来自线索、证据、隐瞒、时间线、利益关系或真实动机；关系互动通过对话、冲突、合作、暧昧或试探推进。当前题材、世界观、主线和前文事实优先；没有前文铺垫时，不得突然加入外星人、超能力、穿越、鬼怪、神秘组织或其他新的世界观层级。每条走向必须包含行动、冲突或关系推进，输出前逐条自检，不合格就重写。只输出一个 JSON 数组，格式为 [{"title":"走向标题","outline":"约150字大纲"}]，共 3 个元素，不输出其他文字。`
    })
  });
  const requiredPromptPlaceholders = Object.freeze({
    'chapter.system':['BOOK_GLOBAL_PROMPT','WRITING_STYLE','BOOK_CHARACTERS','ACTION_RULES','COSTUME_RULES','FORBIDDEN_WORDS','WORLDVIEW','PLOT_SET','GROWTH'],
    'chapter.user':['INSTRUCTION','PREVIOUS_TEXT'],
    'summary.system':[],
    'summary.user':['SUMMARY_TASK','BOOK_CHARACTERS','ACTION_RULES','COSTUME_RULES','FORBIDDEN_WORDS','GROWTH','CHAPTER_EXCERPT'],
    'branch.user':['STRATEGY_NAME','STRATEGY_LABELS','BRANCH_CONTEXT'],
    'analysis.user':['SOURCE_CHAPTERS'],
    'fusion.user':['ANALYSIS_RESULTS'],
    'repair.user':['RAW_RESPONSE']
  });
  const promptParts = Object.freeze(['system','user']);
  const developerPromptKeys = Object.freeze(Object.keys(promptDefaults).flatMap(chain => promptParts.map(part => `${chain}.${part}`)));
  const clonePromptDefaults = () => JSON.parse(JSON.stringify(promptDefaults));
  function normalizeDeveloperPrompts(input) {
    const defaults = clonePromptDefaults();
    if (!input || typeof input !== 'object') return defaults;
    for (const chain of Object.keys(defaults)) for (const part of promptParts) {
      const value = input?.[chain]?.[part];
      if (typeof value === 'string' && value.length <= 20000) defaults[chain][part] = value;
    }
    return defaults;
  }
  function migrateDeveloperPrompts(input) {
    const prompts = normalizeDeveloperPrompts(input);
    if (!input || typeof input !== 'object') return prompts;
    for (const chain of Object.keys(legacyPromptDefaults)) for (const part of Object.keys(legacyPromptDefaults[chain])) {
      if (input?.[chain]?.[part] === legacyPromptDefaults[chain][part]) prompts[chain][part] = promptDefaults[chain][part];
    }
    return prompts;
  }
  function renderPrompt(chain, part, values={}, custom) {
    const templates = normalizeDeveloperPrompts(custom);
    let missing = [];
    const content = templates?.[chain]?.[part].replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
      if (!(key in values)) { missing.push(key); return ''; }
      return String(values[key] ?? '');
    });
    return {content, missing};
  }
  function chainMessages(chain, values={}, custom) {
    const system = renderPrompt(chain, 'system', values, custom);
    const user = renderPrompt(chain, 'user', values, custom);
    return {messages:[{role:'system',content:system.content},{role:'user',content:user.content}],missing:[...new Set([...system.missing,...user.missing])]};
  }
  function defaultDeveloperPrompts() { return clonePromptDefaults(); }

  function characterText(book) {
    const characters = book.characters || [];
    if (!characters.length) return '';
    return '【重要·本书角色库】\n' + characters.map(person => {
      const fields = [
        person.appearance && `外貌体征：${person.appearance}`,
        person.personality && `性格：${person.personality}`,
        person.special && `服装及其他设定：${person.special}`,
        person.relationship && `身份关联：${person.relationship}`
      ].filter(Boolean);
      return `- ${person.name}：${fields.join('；')}`;
    }).join('\n');
  }

  function actionText(actions) {
    if (!actions?.length) return '';
    return '【必须严格遵守的动作描写规则】\n' + actions.map(action => {
      const fields = [
        action.keyPoints && `动作要领：${action.keyPoints}`,
        action.linesUsage && `台词运用：${action.linesUsage}`,
        action.descriptionTips && `描写建议：${action.descriptionTips}`
      ].filter(Boolean);
      return `- 动作"${action.name}"：${fields.join('；')}`;
    }).join('\n');
  }

  function costumeText(costumes) {
    if (!costumes?.length) return '';
    return '【必须保持一致的服装与外观规则】\n' + costumes.map(costume => {
      const fields = [
        costume.details && `服装资料：${costume.details}`,
        !costume.details && costume.styleDetail && `详细款式：${costume.styleDetail}`,
        costume.descriptionTips && `描写建议：${costume.descriptionTips}`
      ].filter(Boolean);
      return `- 服装"${costume.name}"：${fields.join('；')}`;
    }).join('\n');
  }

  function forbiddenText(words) {
    const entries = [...new Set((words || []).map(word => clean(word)).filter(Boolean))];
    if (!entries.length) return '';
    return '【全局禁用词与短语】\n创作时绝对禁止出现以下词语或短语；如需表达相同含义，请改用具体动作、感官或更准确的表达。不要解释这条规则。\n'
      + entries.map(word => `- 绝对禁止出现“${word}”。如需表达相同含义，请改用具体动作、感官或更准确的表达。`).join('\n');
  }

  function growthText(book) {
    const entries = (book.characters || []).flatMap(person =>
      (person.growth || []).map((item, order) => ({
        name: person.name, id: person.id, no: Number(item.chapNo) || 0, text: item.text, order
      })).sort((a, b) => a.no - b.no || a.order - b.order).slice(-3)
    );
    if (!entries.length) return '';
    entries.sort((a, b) => a.no - b.no || a.order - b.order);
    const chosen = entries.slice(-15);
    const last = new Map();
    chosen.forEach((item, index) => last.set(item.id, index));
    return '【角色成长经历（按章号排列，⭐当前状态为最新一条；生成时角色状态以⭐当前状态为准，若与角色库人设冲突以成长经历为准；用户消息中的新变化优先于一切）】\n'
      + chosen.map((item, index) => `第${item.no || '?'}章：${item.name}——${item.text}${last.get(item.id) === index ? ' ⭐当前状态' : ''}`).join('\n');
  }

  function systemPrompt(book, actions, costumes=[], forbiddenWords=[]) {
    const parts = [];
    if (clean(book.globalPrompt)) parts.push(clean(book.globalPrompt));
    if (clean(book.writingStyle)) parts.push('【行文】' + clean(book.writingStyle));
    const characters = characterText(book);
    if (characters) parts.push(characters);
    const action = actionText(actions);
    if (action) parts.push(action);
    const costume = costumeText(costumes);
    if (costume) parts.push(costume);
    const forbidden = forbiddenText(forbiddenWords);
    if (forbidden) parts.push(forbidden);
    if (clean(book.worldview)) parts.push('【世界观】' + clean(book.worldview));
    if (clean(book.plotSet)) parts.push('【情节】' + clean(book.plotSet));
    const growth = growthText(book);
    if (growth) parts.push(growth);
    return parts.join('\n') + '\n输出Markdown正文。';
  }

  function previousText(book, count) {
    const chapters = storyChapters(book);
    const selected = chapters.slice(-Math.max(1, Math.min(50, Number(count) || 5)));
    if (!selected.length) return '开篇。';
    let budget = 5000;
    const picked = [];
    for (let index = selected.length - 1; index >= 0; index--) {
      const chapter = selected[index];
      const summary = clean(chapter.summary);
      const content = String(chapter.content || '');
      const text = summary ? summary.slice(0, 300) : content.length <= 2000
        ? content : content.slice(0, 1000) + '\n…（中段已省略）…\n' + content.slice(-1000);
      if (text.length > budget) break;
      budget -= text.length;
      const label = `${chapterLabel(book, chapter)} ${titleWithoutNumber(chapter.title)}`;
      const mark = chapter.truncated ? '（此章输出未完成）' : '';
      picked.unshift(summary ? `${label}${mark}（摘要）：${text}`
        : `${label}${mark}（未生成摘要，正文首尾节选）\n${text}`);
    }
    return '【前文完整内容】\n' + picked.join('\n\n')
      + (picked.length < selected.length ? '\n…（前文较早章节因总长限制已省略，最近章节已保留）' : '');
  }

  function chapterRequest(book, actions, costumes, instruction, config, continuation, forbiddenWords=[], developerPrompts) {
    const reminders = [
      actions?.length && '请严格按照【必须严格遵守的动作描写规则】中的定义来描写动作。',
      costumes?.length && '请严格按照【必须保持一致的服装与外观规则】中的定义来描写服装。'
    ].filter(Boolean);
    const intro = reminders.length ? reminders.join('\n\n') + '\n\n' : '';
    const previous = previousText(book, config.ctxChapters);
    const user = continuation
      ? `${intro}${instruction}\n\n【前文】\n${previous}`
      : `${intro}创作指令：${instruction}\n\n【前文】\n${previous}\n\n请以 Markdown 标题格式 "# 章节标题" 开头输出正文。`;
    const promptValues = {
      BOOK_GLOBAL_PROMPT: clean(book.globalPrompt) ? '【全局提示词】' + clean(book.globalPrompt) : '',
      WRITING_STYLE: clean(book.writingStyle) ? '【行文规范】' + clean(book.writingStyle) : '',
      BOOK_CHARACTERS: characterText(book),
      ACTION_RULES: actionText(actions),
      COSTUME_RULES: costumeText(costumes),
      FORBIDDEN_WORDS: forbiddenText(forbiddenWords),
      WORLDVIEW: clean(book.worldview) ? '【世界观】' + clean(book.worldview) : '',
      PLOT_SET: clean(book.plotSet) ? '【主线大纲】' + clean(book.plotSet) : '',
      GROWTH: growthText(book),
      ACTION_REMINDER: actions?.length ? '请严格按照【必须严格遵守的动作描写规则】中的定义来描写动作。' : '',
      COSTUME_REMINDER: costumes?.length ? '请严格按照【必须保持一致的服装与外观规则】中的定义来描写服装。' : '',
      INSTRUCTION: instruction,
      PREVIOUS_TEXT: previous,
      TITLE_INSTRUCTION: continuation ? '' : '\n\n请以 Markdown 标题格式 "# 章节标题" 开头输出正文。'
    };
    const prompts = chainMessages('chapter', promptValues, developerPrompts);
    const request = {
      model: config.model,
      messages: [
        ...prompts.messages
      ],
      temperature: Number(config.temperature),
      top_p: Number(config.topP),
      presence_penalty: Number(config.presence),
      frequency_penalty: Number(config.frequency),
      repetition_penalty: Number(config.repetition),
      max_tokens: Math.min(90000, Math.max(3000, Number(config.maxTokens) || 60000))
    };
    const stops = clean(config.stopWords).split(/[,，]/).map(clean).filter(Boolean);
    if (stops.length) request.stop = stops.length === 1 ? stops[0] : stops;
    if (config.thinking) {
      request.thinking = { type: 'enabled' };
      request.reasoning_effort = config.reasoning || 'high';
    }
    return request;
  }

  function titleFrom(content, fallback, number) {
    const lines = content.split('\n').map(clean).filter(Boolean);
    let title = lines.find(line => /^#+\s*\S/.test(line));
    if (title) title = title.replace(/^#+\s*/, '');
    if (!title) title = lines.find(line => line.length <= 30 && !/[。！？.!]$/.test(line));
    title = (title || fallback || '新章节').slice(0, 60);
    const subject = titleWithoutNumber(title);
    return `第${number}章${subject ? ` ${subject}` : ''}`;
  }

  function isTruncated(result, maxTokens) {
    return result.finishReason === 'length'
      || (Number(result.usage?.completion_tokens) >= Number(maxTokens) * .98);
  }

  function summaryRequest(book, chapter, config, actions=[], costumes=[], forbiddenWords=[], developerPrompts) {
    const content = String(chapter.content || '');
    const middle = Math.floor(content.length / 2);
    const excerpt = content.length <= 3000 ? content
      : content.slice(0, 1000) + '\n……（中略）……\n'
        + content.slice(middle - 500, middle + 500) + '\n……（中略）……\n'
        + content.slice(-1000);
    const task = '【任务】\n1. 输出【摘要】标记，后接本章 200 字以内的摘要（必须明确指出出场人物、时间、地点，并包含事件和关键细节；不分段，直接输出摘要正文）。\n'
      + '2. 输出【成长】标记，后接本章角色的经历变化（每行一条，格式：角色名——经历文本）。输出规则：仅当角色发生以下显著变化才输出：①身体状态（受伤、康复、疾病、中毒等）；②心理状态（性格转变、剧烈情绪、心理创伤、心结等）；③人际关系重大变化（爱上、恨上、信任、背叛、结盟等）；④能力与身份（学会新能力、失去能力、获得重要道具、身份地位变化）。吃饭、睡觉、日常对话、普通出行等日常行为一律不输出；纯出场不写；仅当本章所有角色都无上述变化时才允许省略此段；只输出本章新增的变化，不得重复历史经历；角色名优先使用完整姓名，也允许使用角色库中的别名或昵称，但必须保证唯一识别（同名角色必须用完整姓名区分）；若创作指令要求补充某章经历，请一并写入并在行首标注章号（格式：第X章：角色名——经历文本）。没有显著变化时，【成长】标记后留空。\n\n';
    const prompts = chainMessages('summary', {
      SUMMARY_TASK: task,
      CHAPTER_EXCERPT: excerpt,
      BOOK_CHARACTERS: characterText(book),
      ACTION_RULES: actionText(actions),
      COSTUME_RULES: costumeText(costumes),
      FORBIDDEN_WORDS: forbiddenText(forbiddenWords),
      GROWTH: growthText(book)
    }, developerPrompts);
    return {
      model: config.model,
      messages: [
        ...prompts.messages
      ],
      max_tokens: Math.min(10000, Number(config.maxTokens) || 10000),
      temperature: .3,
      thinking: { type: 'disabled' }
    };
  }

  function aliases(name) {
    const value = clean(name);
    return [...new Set([value, value.replace(/【[^】]*】/g, '').replace(/[（(][^（）()]*[）)]/g, '').trim(),
      ...[...value.matchAll(/[【（(]([^】）)]{1,12})[】）)]/g)].map(match => clean(match[1]))].filter(Boolean))];
  }

  function parseSummaryGrowth(content, book, chapter) {
    const summaryAt = content.lastIndexOf('【摘要】');
    const growthAt = content.lastIndexOf('【成长】');
    if (summaryAt < 0) throw new Error('AI 未返回章节摘要');
    const summaryEnd = growthAt > summaryAt ? growthAt : content.length;
    const summary = clean(content.slice(summaryAt + 4, summaryEnd));
    if (!summary || summary.length > 300) throw new Error('章节摘要格式不完整');
    const rawGrowth = growthAt < 0 ? '' : content.slice(growthAt + 4, summaryAt > growthAt ? summaryAt : content.length);
    const growth = [];
    for (const line of rawGrowth.split(/\n+/).map(clean).filter(Boolean)) {
      const entry = line.replace(/^(?:[-*•]\s+|\d+[.、]\s*)/, '');
      const match = entry.match(/^(?:第\s*(\d+)\s*章[：:]?\s*)?(.+?)(?:[—－-]{1,2}|[：:])\s*(.+)$/);
      if (!match) continue;
      const targetNo = match[1] ? Number(match[1]) : chapterNo(book, chapter);
      const target = storyChapters(book)[targetNo - 1];
      const name = clean(match[2]), text = clean(match[3]);
      if (!target || text.length < 2 || text.length > 500) continue;
      const candidates = (book.characters || []).filter(person => aliases(person.name).includes(name));
      if (candidates.length === 1) growth.push({ charId: candidates[0].id, chapterId: target.id, chapNo: targetNo, text });
    }
    return { summary, growth };
  }

  function applyGrowth(book, parsed) {
    for (const item of parsed) {
      const person = (book.characters || []).find(candidate => candidate.id === item.charId);
      if (!person) continue;
      person.growth ||= [];
      if (!person.growth.some(old => old.chapterId === item.chapterId && old.text === item.text)) {
        person.growth.push({ chapterId: item.chapterId, chapNo: item.chapNo, text: item.text });
        person.growth = person.growth.slice(-30);
      }
    }
  }

  const branchStrategies = Object.freeze({
    H: Object.freeze(['主动攻略', '被动转折', '女主视角']),
    X: Object.freeze(['主动攻略', '信息揭示', '关系互动'])
  });

  function normalizeBranchStrategy(strategy) {
    return strategy === 'H' ? 'H' : 'X';
  }

  function branchContext(book, actions=[], costumes=[], forbiddenWords=[]) {
    const chapters = storyChapters(book);
    const latest = chapters.at(-1);
    if (!latest) return '';
    const parts = [];

    // Keep the book-level and library constraints at the front of the user prompt.
    // Chapter context and growth change every generation, so they stay in the suffix
    // and do not invalidate the reusable prefix of the direction request.
    if (clean(book.globalPrompt)) parts.push('【长期提示】' + clean(book.globalPrompt));
    if (clean(book.writingStyle)) parts.push('【行文】' + clean(book.writingStyle));
    if (clean(book.worldview)) parts.push('【世界观】' + clean(book.worldview).slice(0, 800));
    if (clean(book.plotSet)) parts.push('【主线大纲】' + clean(book.plotSet).slice(0, 800));
    const characters = characterText(book);
    if (characters) parts.push(characters.replace('【重要·本书角色库】', '【本书角色库】'));
    const action = actionText(actions);
    if (action) parts.push(action);
    const costume = costumeText(costumes);
    if (costume) parts.push(costume);
    const forbidden = forbiddenText(forbiddenWords);
    if (forbidden) parts.push(forbidden);

    const segment = chapter => {
      const label = `${chapterLabel(book, chapter)} ${titleWithoutNumber(chapter.title)}`;
      const content = String(chapter.content || '');
      return clean(chapter.summary) ? `${label}（摘要）：${clean(chapter.summary).slice(0, 300)}`
        : `${label}（未生成摘要，正文首尾节选）：${content.length <= 500 ? content : content.slice(0, 250) + '\n…（中段已省略）…\n' + content.slice(-250)}`;
    };
    const recent = [segment(latest)];
    let budget = 2000 - recent[0].length;
    const earlier = [];
    for (let index = chapters.length - 2; index >= Math.max(0, chapters.length - 11); index--) {
      const text = segment(chapters[index]);
      if (budget - text.length < 0 && earlier.length) break;
      earlier.unshift(text);
      budget -= text.length;
    }
    if (earlier.length) recent.push('【前10章摘要】\n' + earlier.join('\n'));
    parts.push('【前文信息】\n' + recent.join('\n\n'));
    const growth = growthText(book);
    if (growth) parts.push(growth);
    return parts.join('\n\n');
  }


  function branchRequest(book, config, actions=[], costumes=[], forbiddenWords=[], strategy='X', developerPrompts) {
    const selected = normalizeBranchStrategy(strategy);
    const labels = branchStrategies[selected];
    const values = {
      BOOK_GLOBAL_PROMPT: clean(book.globalPrompt) ? '【长期提示】' + clean(book.globalPrompt) : '',
      WRITING_STYLE: clean(book.writingStyle) ? '【行文】' + clean(book.writingStyle) : '',
      WORLDVIEW: clean(book.worldview) ? '【世界观】' + clean(book.worldview).slice(0, 800) : '',
      PLOT_SET: clean(book.plotSet) ? '【主线大纲】' + clean(book.plotSet).slice(0, 800) : '',
      BOOK_CHARACTERS: characterText(book).replace('【重要·本书角色库】', '【本书角色库】'),
      ACTION_RULES: actionText(actions), COSTUME_RULES: costumeText(costumes),
      FORBIDDEN_WORDS: forbiddenText(forbiddenWords), GROWTH: growthText(book),
      STRATEGY_NAME: selected + '策略', STRATEGY_LABELS: `①${labels[0]} ②${labels[1]} ③${labels[2]}`,
      BRANCH_CONTEXT: branchContext(book, actions, costumes, forbiddenWords)
    };
    const prompts = chainMessages('branch', values, developerPrompts);
    return {
      model: config.model,
      messages: [
        ...prompts.messages
      ],
      temperature: Number(config.temperature),
      max_tokens: 3000
    };
  }

  global.NovelCore = { chapterRequest, titleFrom, isTruncated, summaryRequest,
    parseSummaryGrowth, applyGrowth, branchRequest, previousText, systemPrompt, growthText, forbiddenText,
    branchStrategies, normalizeBranchStrategy, promptDefaults, promptLabels, developerPromptKeys, requiredPromptPlaceholders,
    defaultDeveloperPrompts, normalizeDeveloperPrompts, migrateDeveloperPrompts, renderPrompt, chainMessages,
    storyChapters, chapterNo, chapterLabel };
})(window);
