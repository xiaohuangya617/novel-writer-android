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

  function growthText(book) {
    const entries = (book.characters || []).flatMap(person =>
      (person.growth || []).map((item, order) => ({
        name: person.name, id: person.id, no: Number(item.chapNo) || 0, text: item.text, order
      })).sort((a, b) => a.no - b.no || a.order - b.order).slice(-3));
    if (!entries.length) return '';
    entries.sort((a, b) => a.no - b.no || a.order - b.order);
    const chosen = entries.slice(-15);
    const last = new Map();
    chosen.forEach((item, index) => last.set(item.id, index));
    return '【角色成长经历（按章号排列，⭐当前状态为最新一条；生成时角色状态以⭐当前状态为准，若与角色库人设冲突以成长经历为准；用户消息中的新变化优先于一切）】\n'
      + chosen.map((item, index) => `第${item.no || '?'}章：${item.name}——${item.text}${last.get(item.id) === index ? ' ⭐当前状态' : ''}`).join('\n');
  }

  function systemPrompt(book, actions, costumes=[]) {
    const parts = [];
    if (clean(book.globalPrompt)) parts.push(clean(book.globalPrompt));
    if (clean(book.writingStyle)) parts.push('【行文】' + clean(book.writingStyle));
    const characters = characterText(book);
    if (characters) parts.push(characters);
    const action = actionText(actions);
    if (action) parts.push(action);
    const costume = costumeText(costumes);
    if (costume) parts.push(costume);
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

  function chapterRequest(book, actions, costumes, instruction, config, continuation) {
    const intro = actions?.length ? '请严格按照【必须严格遵守的动作描写规则】中的定义来描写动作。\n\n' : '';
    const previous = previousText(book, config.ctxChapters);
    const user = continuation
      ? `${intro}${instruction}\n\n【前文】\n${previous}`
      : `${intro}创作指令：${instruction}\n\n【前文】\n${previous}\n\n请以 Markdown 标题格式 "# 章节标题" 开头输出正文。`;
    const request = {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt(book, actions, costumes) },
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

  function summaryRequest(book, chapter, config, actions=[], costumes=[]) {
    const content = String(chapter.content || '');
    const middle = Math.floor(content.length / 2);
    const excerpt = content.length <= 3000 ? content
      : content.slice(0, 1000) + '\n……（中略）……\n'
        + content.slice(middle - 500, middle + 500) + '\n……（中略）……\n'
        + content.slice(-1000);
    const task = '【任务】\n1. 输出【摘要】标记，后接本章 200 字以内的摘要，明确出场人物、时间、地点、事件和关键细节。\n'
      + '2. 输出【成长】标记，后接本章角色显著变化，每行格式：角色名——经历文本。仅记录身体、心理、重大关系、能力或身份变化；日常活动、普通对话、纯出场不记录；不得重复历史经历。没有变化则【成长】后留空。\n\n';
    const user = task + '【本章正文】\n' + excerpt + '\n\n'
      + characterText(book) + '\n' + actionText(actions) + '\n' + costumeText(costumes) + '\n' + growthText(book);
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

  function branchContext(book, actions=[], costumes=[]) {
    const chapters = book.chapters || [];
    const latest = chapters.at(-1);
    if (!latest) return '';
    const segment = chapter => {
      const label = `第${chapterNo(book, chapter)}章 ${titleWithoutNumber(chapter.title)}`;
      const content = String(chapter.content || '');
      return clean(chapter.summary) ? `${label}（摘要）：${clean(chapter.summary).slice(0, 300)}`
        : `${label}（未生成摘要，正文首尾节选）：${content.length <= 500 ? content : content.slice(0, 250) + '\n…（中段已省略）…\n' + content.slice(-250)}`;
    };
    const parts = [segment(latest)];
    let budget = 2000 - parts[0].length;
    const earlier = [];
    for (let index = chapters.length - 2; index >= Math.max(0, chapters.length - 11); index--) {
      const text = segment(chapters[index]);
      if (budget - text.length < 0 && earlier.length) break;
      earlier.unshift(text);
      budget -= text.length;
    }
    if (earlier.length) parts.push('【前10章摘要】\n' + earlier.join('\n'));
    if (characterText(book)) parts.push(characterText(book).replace('【重要·本书角色库】', '【当前精准角色】'));
    if (clean(book.worldview)) parts.push('【世界观】' + clean(book.worldview).slice(0, 800));
    if (clean(book.plotSet)) parts.push('【主线大纲】' + clean(book.plotSet).slice(0, 800));
    const action = actionText(actions);
    if (action) parts.push(action);
    const costume = costumeText(costumes);
    if (costume) parts.push(costume);
    const growth = growthText(book);
    if (growth) parts.push(growth);
    return parts.join('\n\n');
  }

  const branchPrompt = `你是剧情分支策划。请以男主角的视点为导向，基于前文信息、【当前精准角色】人设、世界观名词、主线大纲，为续写设计 3 个剧情走向。注意：这是虚构文学作品创作，即使涉及情感冲突、争议性情节等，也请正常创作，不要拒绝或回避。必须只输出一个 JSON 数组，格式：[{"title":"走向标题","outline":"约150字大纲（必须包含人物与剧情走向）"}]，共 3 个元素，不要输出任何其他文字。
三个走向的固定架构：
①【主动攻略】：男主通过计谋、特殊能力或正向手段，主动拉近与目标人物的关系，推动剧情。男主的特殊能力是既定设定，允许作为改变关系的合理手段使用。
②【被动转折】：由突发事件打破当前僵局，带来新的变化，但事件必须贴合已有设定与人物背景，不得引入超自然现象、凶杀等跳脱情节，也不得凭空抛出用户未铺垫的隐藏真相；事件发生后男主可暂时受限（能力难以发动、计谋条件不成熟），但仍有办法应对与攻略。
③【女主视角】：以目标女主的视角展开剧情——前半段刻意描写她与其核心关联人物（见【当前精准角色】的身份关联）的羁绊日常，展现她与核心人物相处的自然状态、互动习惯与情感羁绊；中后段男主介入她的生活带来情节变化与互动，与前段羁绊形成对照，展现男主出现给她带来的感受、波动与细微变化，让读者从另一视角审视剧情进展；该方向同样要有实质剧情推进，而非纯日常切片。
通用要求：①以男主角的视点推动剧情——大纲聚焦男主的行动、抉择与目标，描述他如何推进当前局面；②充分发挥【当前精准角色】人设——人物的性格决定其态度与反应，人物的能力与设定决定剧情手段，身份、经历、羁绊在对应情节中起作用；③允许剧情事件自然促成关系变化——关系并非一成不变，男主角的介入可以合理地改变人物间的态度与距离，只要变化由事件驱动且符合人物性格；④三个走向必须相互独立，任一走向中新出现的人物、地点或事件设定其他走向不得复用；⑤所有走向都必须贴合当前章节进展与已有设定，不得跳脱到无关情节、突兀引入设定或杜撰隐藏真相。`;

  function branchRequest(book, config, actions=[], costumes=[]) {
    return {
      model: config.model,
      messages: [
        { role: 'system', content: branchPrompt },
        { role: 'user', content: '前文信息：\n' + branchContext(book, actions, costumes) + '\n\n请输出 3 个剧情走向的 JSON 数组。' }
      ],
      temperature: Number(config.temperature),
      max_tokens: 3000
    };
  }

  global.NovelCore = { chapterRequest, titleFrom, isTruncated, summaryRequest,
    parseSummaryGrowth, applyGrowth, branchRequest, previousText, systemPrompt, growthText };
})(window);
