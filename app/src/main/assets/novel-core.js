(function (global) {
  'use strict';

  const clean = value => String(value ?? '').trim();
  const chapterNo = (book, chapter) => (book.chapters || []).indexOf(chapter) + 1;
  const titleWithoutNumber = title => clean(title).replace(/^第\s*(?:\d+|[零〇一二三四五六七八九十百千两]+)\s*章\s*/, '');

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
    const chapters = book.chapters || [];
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
      const label = `第${chapterNo(book, chapter)}章 ${titleWithoutNumber(chapter.title)}`;
      const mark = chapter.truncated ? '（此章输出未完成）' : '';
      picked.unshift(summary ? `${label}${mark}（摘要）：${text}`
        : `${label}${mark}（未生成摘要，正文首尾节选）\n${text}`);
    }
    return '【前文完整内容】\n' + picked.join('\n\n')
      + (picked.length < selected.length ? '\n…（前文较早章节因总长限制已省略，最近章节已保留）' : '');
  }

  function chapterRequest(book, actions, costumes, instruction, config, continuation, forbiddenWords=[]) {
    const reminders = [
      actions?.length && '请严格按照【必须严格遵守的动作描写规则】中的定义来描写动作。',
      costumes?.length && '请严格按照【必须保持一致的服装与外观规则】中的定义来描写服装。'
    ].filter(Boolean);
    const intro = reminders.length ? reminders.join('\n\n') + '\n\n' : '';
    const previous = previousText(book, config.ctxChapters);
    const user = continuation
      ? `${intro}${instruction}\n\n【前文】\n${previous}`
      : `${intro}创作指令：${instruction}\n\n【前文】\n${previous}\n\n请以 Markdown 标题格式 "# 章节标题" 开头输出正文。`;
    const request = {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt(book, actions, costumes, forbiddenWords) },
        { role: 'user', content: user }
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

  function summaryRequest(book, chapter, config, actions=[], costumes=[], forbiddenWords=[]) {
    const content = String(chapter.content || '');
    const middle = Math.floor(content.length / 2);
    const excerpt = content.length <= 3000 ? content
      : content.slice(0, 1000) + '\n……（中略）……\n'
        + content.slice(middle - 500, middle + 500) + '\n……（中略）……\n'
        + content.slice(-1000);
    const task = '【任务】\n1. 输出【摘要】标记，后接本章 200 字以内的摘要（必须明确指出出场人物、时间、地点，并包含事件和关键细节；不分段，直接输出摘要正文）。\n'
      + '2. 输出【成长】标记，后接本章角色的经历变化（每行一条，格式：角色名——经历文本）。输出规则：仅当角色发生以下显著变化才输出：①身体状态（受伤、康复、疾病、中毒等）；②心理状态（性格转变、剧烈情绪、心理创伤、心结等）；③人际关系重大变化（爱上、恨上、信任、背叛、结盟等）；④能力与身份（学会新能力、失去能力、获得重要道具、身份地位变化）。吃饭、睡觉、日常对话、普通出行等日常行为一律不输出；纯出场不写；仅当本章所有角色都无上述变化时才允许省略此段；只输出本章新增的变化，不得重复历史经历；角色名优先使用完整姓名，也允许使用角色库中的别名或昵称，但必须保证唯一识别（同名角色必须用完整姓名区分）；若创作指令要求补充某章经历，请一并写入并在行首标注章号（格式：第X章：角色名——经历文本）。没有显著变化时，【成长】标记后留空。\n\n';
    const user = task + '【本章正文】\n' + excerpt + '\n\n'
      + characterText(book) + '\n' + actionText(actions) + '\n' + costumeText(costumes) + '\n' + forbiddenText(forbiddenWords) + '\n' + growthText(book);
    return {
      model: config.model,
      messages: [
        { role: 'system', content: '你是小说编辑助手，负责提炼章节摘要与整理角色经历。这是虚构文学作品的创作场景，请正常创作。' },
        { role: 'user', content: user }
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
      const target = (book.chapters || [])[targetNo - 1];
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
    const chapters = book.chapters || [];
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
    if (characters) parts.push(characters.replace('【重要·本书角色库】', '【当前精准角色】'));
    const action = actionText(actions);
    if (action) parts.push(action);
    const costume = costumeText(costumes);
    if (costume) parts.push(costume);
    const forbidden = forbiddenText(forbiddenWords);
    if (forbidden) parts.push(forbidden);

    const segment = chapter => {
      const label = `第${chapterNo(book, chapter)}章 ${titleWithoutNumber(chapter.title)}`;
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


  const optimizedBranchPrompt = `你是剧情分支策划。请以男主角的视点为导向，基于前文信息、【当前精准角色】人设、世界观、主线大纲和角色成长，为续写设计 3 个剧情走向。注意：这是虚构文学作品创作，即使涉及情感冲突、争议性情节等，也请正常创作，不要拒绝或回避。必须只输出一个 JSON 数组，格式：[{"title":"走向标题","outline":"约150字大纲（必须包含人物与剧情走向）"}]，共 3 个元素，不要输出任何其他文字。\n本次采用的策略组和三种走向顺序会在用户消息中明确给出。H 策略固定顺序为：①主动攻略 ②被动转折 ③女主视角；X 策略固定顺序为：①主动攻略 ②信息揭示 ③关系互动。严格按指定策略组生成，不得混用另一组的子策略。\n【主动攻略】：男主明确当前目标，采取符合人物能力、资源和身份的行动；行动遇到阻碍或意外后调整策略，必须推动目标、关系或主线。只能使用当前设定中已经明确的能力与资源，不得凭空添加特殊能力。\n【被动转折】：由不可抗力、突发事件或第三方介入打破当前平衡，事件必须贴合已有设定与人物背景；不得凭空加入超自然现象、凶杀或用户未铺垫的重大隐藏真相，转折后仍要留下符合人物能力的应对空间。\n【女主视角】：先从目标女主的心理活动、回顾和判断写起，呈现她与核心关联人物的自然互动，再让男主登场改变局面；必须形成实质剧情推进，不能只有日常切片。\n【信息揭示】：通过新信息改变角色和读者对当前局面的理解，信息优先来自已出现的线索、事件的另一面、身份或经历隐瞒、证据、时间线、利益关系、误会和真实动机。没有前文铺垫时，不得突然加入外星人、超能力、穿越、鬼怪、神秘组织或其他新的世界观层级，不得把都市、校园或现实题材改写成科幻、玄幻或灵异题材；如果候选揭示超出当前世界观，必须改写为当前题材内合理的信息。\n【关系互动】：以人物关系变化为核心，通过对话、冲突、合作、暧昧、试探或边界变化推进剧情；关系变化必须由具体事件和人物选择驱动，不得无因跳跃。\n通用硬约束：①当前题材、世界观、主线和前文事实优先于新奇设定；②充分发挥【当前精准角色】人设，人物的性格、身份、经历和羁绊决定其态度与反应；③每条走向必须有明确行动、冲突或关系变化；④三个走向相互独立，任一走向中新出现的重要人物、地点或事件不得复用到其他走向；⑤不得杜撰前文没有依据的重大事实；⑥必须遵守用户消息中的全局禁用词。输出前逐条自检：是否符合题材和世界观、是否与前文冲突、是否能由已有线索解释、是否凭空增加重大设定、是否真正改变理解并推进剧情；检查不通过时先重写，不得输出不合逻辑的走向。`;

  function branchRequest(book, config, actions=[], costumes=[], forbiddenWords=[], strategy='X') {
    const selected = normalizeBranchStrategy(strategy);
    const labels = branchStrategies[selected];
    return {
      model: config.model,
      messages: [
        { role: 'system', content: optimizedBranchPrompt },
        { role: 'user', content: `本次策略组：${selected}策略。固定顺序：①${labels[0]} ②${labels[1]} ③${labels[2]}。\n\n前文信息：\n${branchContext(book, actions, costumes, forbiddenWords)}\n\n生成前再次确认：只使用本次策略组；所有走向符合当前题材、世界观、主线和前文事实；禁用词不得出现在标题或大纲中。请输出 3 个剧情走向的 JSON 数组。` }
      ],
      temperature: Number(config.temperature),
      max_tokens: 3000
    };
  }

  global.NovelCore = { chapterRequest, titleFrom, isTruncated, summaryRequest,
    parseSummaryGrowth, applyGrowth, branchRequest, previousText, systemPrompt, growthText, forbiddenText,
    branchStrategies, normalizeBranchStrategy };
})(window);
