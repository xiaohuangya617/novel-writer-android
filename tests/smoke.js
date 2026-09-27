const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const { chromium } = require('playwright-core');

const assets = path.resolve(__dirname, '../app/src/main/assets');
const core = {};
vm.runInNewContext(fs.readFileSync(path.join(assets, 'novel-core.js'), 'utf8'), { window: core });

const characters = Array.from({ length: 6 }, (_, index) => ({
  id: `c${index}`, name: `角色${index}`, growth: Array.from({ length: 4 }, (_, offset) => ({
    chapNo: index * 4 + offset + 1, text: `成长${index}-${offset}`
  }))
}));
const book = { characters, chapters: [], globalPrompt: '长期提示', writingStyle: '行文' };
const growth = core.NovelCore.growthText(book);
assert.equal(growth.split('\n').length - 1, 15);
assert.ok(growth.includes('第6章：'));
assert.ok(!growth.includes('第4章：'));
assert.ok(growth.includes('第24章：'));
const prompt = core.NovelCore.systemPrompt(book, []);
assert.ok(prompt.indexOf('长期提示') < prompt.indexOf('【角色成长经历'));
assert.ok(core.NovelCore.summaryRequest(book, { content: '正文' }, { model: 'test' }).messages[1].content.includes(growth));
const branch = core.NovelCore.branchRequest({ ...book, plotSet: '主线', chapters: [{ title: '第1章', summary: '最新进展' }] }, { model: 'test', temperature: '1.0' });
assert.ok(branch.messages[1].content.includes(growth));
assert.ok(branch.messages[1].content.indexOf('【主线大纲】') < branch.messages[1].content.indexOf('【角色成长经历'));
assert.equal(core.NovelCore.titleFrom('# 第一章\n\n正文', '备用标题', 101), '第101章');
assert.equal(core.NovelCore.titleFrom('# 第一章 新的线索\n\n正文', '备用标题', 101), '第101章 新的线索');
const unfinished = { chapters: [{ title: '第1章 起点', content: '开头标记' + '中段内容'.repeat(400) + '结尾转折' }] };
const fallback = core.NovelCore.previousText(unfinished, 5);
assert.ok(fallback.includes('开头标记') && fallback.includes('结尾转折'));
assert.ok(fallback.includes('未生成摘要'));
const directionFallback = core.NovelCore.branchRequest(unfinished, { model: 'test', temperature: '1.0' }).messages[1].content;
assert.ok(directionFallback.includes('开头标记') && directionFallback.includes('结尾转折'));
const growthBook = { characters: [{ id: 'aoi', name: '朝日奈葵（葵）', growth: [] }], chapters: [{ id: 'growth-chapter', content: '正文' }] };
for (const line of ['朝日奈葵——获得信任', '朝日奈葵：获得信任', '- 朝日奈葵——获得信任']) {
  const parsed = core.NovelCore.parseSummaryGrowth(`【摘要】角色关系发生变化。\n【成长】\n${line}`, growthBook, growthBook.chapters[0]);
  assert.equal(parsed.growth.length, 1, line);
  assert.equal(parsed.growth[0].charId, 'aoi');
}

const chapters = Array.from({ length: 100 }, (_, index) => ({
  id: `ch${index}`, title: `第${index + 1}章 测试`, content: `章节 ${index + 1}\n`.repeat(80), summary: '摘要'
}));
const saved = {
  books: [{ id: 'book', name: '测试作品', chapters, characters: [], chatHistory: [], draft: '写下一章' }],
  actions: [], activeBookId: 'book', selectedChapterId: 'ch49', activeTab: 'messages',
  apiConfig: { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash' },
  railCompact: false, readerContinuous: false
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true
  });
  try {
    const freshContext = await browser.newContext({ viewport: { width: 412, height: 958 } });
    const freshPage = await freshContext.newPage();
    await freshPage.route('https://app.local/**', route => {
      const target = path.join(assets, new URL(route.request().url()).pathname.slice(1));
      const extension = path.extname(target);
      route.fulfill({ body: fs.readFileSync(target), contentType: extension === '.html' ? 'text/html' : extension === '.js' ? 'application/javascript' : extension === '.css' ? 'text/css' : 'application/octet-stream' });
    });
    await freshPage.goto('https://app.local/index.html');
    assert.equal(await freshPage.locator('#sheetTitle').innerText(), '开始使用');
    assert.deepEqual(await freshPage.evaluate(() => [state.readerFontSize, state.messageFontSize]), [20, 16]);
    assert.equal(await freshPage.locator('#startRestore').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(19, 109, 81)');
    await freshPage.locator('#startCreate').click();
    assert.equal(await freshPage.locator('#sheetTitle').innerText(), '创建第一本书');
    await freshPage.locator('#closeSheet').click();
    assert.equal(await freshPage.locator('#createFirstBook').isVisible(), true);
    await freshPage.reload();
    const archive = { appArchiveVersion: 1, books: saved.books, globalActions: [], currentBookId: 'book', appConfig: saved.apiConfig };
    const chooseArchive = async () => {
      const pending = freshPage.waitForEvent('filechooser');
      await freshPage.locator('#startRestore').click();
      await (await pending).setFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(archive)) });
    };
    await chooseArchive();
    assert.equal(await freshPage.locator('#sheetTitle').innerText(), '确认恢复');
    await freshPage.locator('#cancelRestore').click();
    assert.equal(await freshPage.locator('#sheetTitle').innerText(), '开始使用');
    await chooseArchive();
    await freshPage.locator('#confirmRestore').click();
    assert.equal(await freshPage.locator('#sheetBackdrop').isHidden(), true);
    assert.equal(await freshPage.locator('#topBookName').innerText(), '测试作品');
    assert.deepEqual(await freshPage.evaluate(() => [state.globalCharacters.length, state.readerFontSize, state.messageFontSize]), [0, 20, 16]);
    await freshPage.locator('#archiveButton').click();
    assert.equal(await freshPage.locator('label[for="restoreFile"]').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(19, 109, 81)');
    assert.deepEqual(await freshPage.locator('#sheetBody .sheet-list > button, #sheetBody .sheet-list > label').allInnerTexts(), [
      '导出本书正文（txt）', '导出项目存档（app）', '分享项目存档（app）',
      '分享项目存档（html）', '恢复项目存档（app）', '初始化所有数据'
    ]);
    await freshPage.locator('#closeSheet').click();
    await freshPage.locator('#menuButton').click();
    await freshPage.locator('[data-sheet="globalRoles"]').click();
    await freshPage.locator('#addGlobalRole').click();
    await freshPage.locator('#globalRoleName').fill('朝日奈葵');
    await freshPage.locator('#globalRolePersonality').fill('全局性格');
    await freshPage.locator('#globalRoleForm button[type="submit"]').click();
    await freshPage.setViewportSize({ width: 320, height: 640 });
    assert.ok(await freshPage.locator('.library-row').evaluate(row => {
      const card=row.getBoundingClientRect(),buttons=[...row.querySelectorAll('button')].map(item=>item.getBoundingClientRect());
      return Math.round(card.height)===78&&buttons.length===3&&buttons.every(button=>button.left>=card.left&&button.right<=card.right&&Math.abs(button.top-buttons[0].top)<1);
    }));
    await freshPage.locator('[data-import-global-role]').click();
    await freshPage.locator('#importGlobalRoleForm button[type="submit"]').click();
    const importedRole = await freshPage.evaluate(() => ({ global: state.globalCharacters[0], local: book().characters.at(-1), archive: backupObject() }));
    assert.notEqual(importedRole.local.id, importedRole.global.id);
    assert.equal(importedRole.local.personality, '全局性格');
    assert.deepEqual(importedRole.local.growth, []);
    assert.equal(importedRole.archive.globalCharacters[0].name, '朝日奈葵');
    await freshPage.locator('#closeSheet').click();
    await freshPage.locator('#menuButton').click();
    await freshPage.locator('[data-sheet="globalRoles"]').click();
    await freshPage.locator('[data-import-global-role]').click();
    await freshPage.locator('#importGlobalRoleForm button[type="submit"]').click();
    assert.match(await freshPage.locator('#importRoleError').innerText(), /同名角色/);
    assert.equal(await freshPage.evaluate(() => book().characters.filter(c => c.name === '朝日奈葵').length), 1);
    await freshPage.locator('#cancelImportGlobalRole').click();
    await freshPage.locator('[data-edit-global-role]').click();
    await freshPage.locator('#globalRolePersonality').fill('修改后的全局性格');
    await freshPage.locator('#globalRoleForm button[type="submit"]').click();
    assert.equal(await freshPage.evaluate(() => book().characters.at(-1).personality), '全局性格');
    assert.ok(await freshPage.evaluate(() => {
      const prompt=NovelCore.systemPrompt(book(),state.actions);
      return prompt.includes('全局性格')&&!prompt.includes('修改后的全局性格');
    }));
    await freshPage.locator('#closeSheet').click();
    await freshPage.locator('#menuButton').click();
    await freshPage.locator('[data-sheet="books"]').click();
    await freshPage.locator('#manageAddBook').click();
    await freshPage.locator('#newBookName').fill('待删除的书');
    await freshPage.locator('#newBookForm button[type="submit"]').click();
    await freshPage.locator('#menuButton').click();
    await freshPage.locator('[data-sheet="books"]').click();
    await freshPage.locator('#manageDeleteBook').click();
    await freshPage.locator('[data-delete-book]').last().click();
    await freshPage.locator('#confirmDeleteBook').click();
    assert.equal(await freshPage.evaluate(() => state.globalCharacters[0].personality), '修改后的全局性格');
    assert.equal(await freshPage.evaluate(() => book().characters.at(-1).personality), '全局性格');
    await freshPage.locator('#menuButton').click();
    await freshPage.locator('[data-sheet="fontSize"]').click();
    assert.equal(await freshPage.locator('#readerFontRange').getAttribute('max'), '30');
    await freshPage.locator('#readerFontRange').fill('20');
    assert.equal(await freshPage.evaluate(() => state.readerFontSize), 20);
    await freshPage.locator('#readerFontRange').fill('30');
    assert.equal(await freshPage.evaluate(() => state.readerFontSize), 30);
    await freshPage.locator('#resetReaderFont').click();
    assert.equal(await freshPage.evaluate(() => state.readerFontSize), 20);
    await freshPage.locator('#closeSheet').click();
    await freshPage.locator('[data-tab="reader"]').click();
    assert.equal(await freshPage.locator('.prose').evaluate(el => getComputedStyle(el).fontSize), '20px');
    assert.equal(await freshPage.locator('.reader h1').evaluate(el => getComputedStyle(el).fontSize), '19px');
    await freshPage.locator('#readerModeButton').click();
    await freshPage.waitForFunction(() => document.getElementById('readerLoading').hidden);
    const visibleBeforeSizeChange = await freshPage.evaluate(() => state.selectedChapterId);
    await freshPage.locator('#menuButton').click();
    await freshPage.locator('[data-sheet="fontSize"]').click();
    await freshPage.locator('#readerFontRange').fill('18');
    assert.equal(await freshPage.locator('.reader-stream .prose').first().evaluate(el => getComputedStyle(el).fontSize), '18px');
    assert.equal(await freshPage.evaluate(() => state.selectedChapterId), visibleBeforeSizeChange);
    await freshPage.locator('#readerFontRange').fill('20');
    await freshPage.locator('#closeSheet').click();
    await freshPage.locator('[data-tab="messages"]').click();
    await freshPage.evaluate(() => { book().chatHistory.push({ role:'assistant', content:'消息字号测试' }); render() });
    await freshPage.locator('#menuButton').click();
    await freshPage.locator('[data-sheet="messageFontSize"]').click();
    assert.equal(await freshPage.locator('#messageFontRange').getAttribute('max'), '30');
    await freshPage.locator('#messageFontRange').fill('30');
    await freshPage.locator('#resetMessageFont').click();
    assert.equal(await freshPage.evaluate(() => state.messageFontSize), 16);
    await freshPage.locator('#messageFontRange').fill('30');
    assert.equal(await freshPage.locator('#instruction').evaluate(el => getComputedStyle(el).fontSize), '30px');
    assert.equal(await freshPage.locator('.message.assistant').last().evaluate(el => getComputedStyle(el).fontSize), '30px');
    assert.equal(await freshPage.evaluate(() => { const pending=document.createElement('div');pending.className='message pending';document.getElementById('messageList').append(pending);const size=getComputedStyle(pending).fontSize;pending.remove();return size }), '12px');
    assert.equal(await freshPage.locator('.panel-header h1').evaluate(el => getComputedStyle(el).fontSize), '18px');
    await freshPage.locator('#closeSheet').click();
    await freshPage.locator('[data-tab="reader"]').click();
    assert.equal(await freshPage.locator('.prose').evaluate(el => getComputedStyle(el).fontSize), '20px');
    const featureArchive = await freshPage.evaluate(() => backupObject());
    assert.equal(featureArchive.appReaderFontSize, 20);
    assert.equal(featureArchive.appMessageFontSize, 30);
    const htmlArchive = await freshPage.evaluate(() => htmlBackupObject());
    assert.equal(htmlArchive.version, '7.7');
    assert.equal(htmlArchive.books[0].name, '测试作品');
    assert.equal(htmlArchive.globalCharacters[0].name, '朝日奈葵');
    assert.equal(htmlArchive.apiConfig.key, '');
    assert.ok(!('appArchiveVersion' in htmlArchive));
    assert.ok(!('appReaderFontSize' in htmlArchive));
    assert.ok(!('appMessageFontSize' in htmlArchive));
    assert.ok(!('appConfig' in htmlArchive));
    await freshPage.reload();
    assert.equal(await freshPage.locator('.prose').evaluate(el => getComputedStyle(el).fontSize), '20px');
    await freshPage.evaluate(data => restoreProject(data), featureArchive);
    await freshPage.locator('#confirmRestore').click();
    assert.deepEqual(await freshPage.evaluate(() => [state.readerFontSize, state.messageFontSize]), [20, 30]);
    assert.equal(await freshPage.evaluate(() => state.globalCharacters[0].name), '朝日奈葵');
    await freshPage.locator('#menuButton').click();
    await freshPage.locator('[data-sheet="globalRoles"]').click();
    await freshPage.locator('[data-delete-global-role]').click();
    await freshPage.locator('#confirmDeleteGlobalRole').click();
    assert.equal(await freshPage.evaluate(() => state.globalCharacters.length), 0);
    assert.equal(await freshPage.evaluate(() => book().characters.at(-1).name), '朝日奈葵');
    await freshContext.close();

    const nativeFresh = await browser.newContext({ viewport: { width: 412, height: 958 } });
    await nativeFresh.addInitScript(config => {
      window.AndroidBridge = {
        loadProject: () => null, hasProject: () => false,
        loadApiSettings: () => JSON.stringify({ ...config, key: '' }),
        saveApiSettings: () => true, saveProject: json => (localStorage.setItem('native_project', json), true),
        chooseProject: () => localStorage.setItem('native_choose_called', 'yes'), pageReady: () => {},
        appVersion: () => '1.22',
        checkUpdate: () => { localStorage.setItem('update_check_called', 'yes'); },
        refreshUpdate: () => { localStorage.setItem('update_refresh_called', 'yes'); },
        downloadUpdate: () => { localStorage.setItem('update_download_called', 'yes'); },
        installUpdate: () => { localStorage.setItem('update_install_called', 'yes'); },
        cancelUpdateDownload: () => { localStorage.setItem('update_cancel_called', 'yes'); },
        shareProject: json => { localStorage.setItem('shared_app', json); },
        shareHtmlProject: json => { localStorage.setItem('shared_html', json); }
      };
    }, saved.apiConfig);
    const nativeFreshPage = await nativeFresh.newPage();
    await nativeFreshPage.route('https://app.local/**', route => {
      const target = path.join(assets, new URL(route.request().url()).pathname.slice(1));
      const extension = path.extname(target);
      route.fulfill({ body: fs.readFileSync(target), contentType: extension === '.html' ? 'text/html' : extension === '.js' ? 'application/javascript' : extension === '.css' ? 'text/css' : 'application/octet-stream' });
    });
    await nativeFreshPage.goto('https://app.local/index.html');
    await nativeFreshPage.locator('#startRestore').click();
    assert.equal(await nativeFreshPage.evaluate(() => localStorage.getItem('native_choose_called')), 'yes');
    await nativeFreshPage.evaluate(data => window.nativeBackupImported(JSON.stringify(data)), archive);
    await nativeFreshPage.locator('#confirmRestore').click();
    assert.equal(await nativeFreshPage.locator('#topBookName').innerText(), '测试作品');
    await nativeFreshPage.locator('#menuButton').click();
    await nativeFreshPage.locator('[data-sheet="version"]').click();
    assert.match(await nativeFreshPage.locator('#sheetBody').innerText(), /1\.22/);
    assert.equal(await nativeFreshPage.evaluate(() => localStorage.getItem('update_refresh_called')), 'yes');
    await nativeFreshPage.locator('#checkUpdate').click();
    assert.equal(await nativeFreshPage.evaluate(() => localStorage.getItem('update_check_called')), 'yes');
    await nativeFreshPage.evaluate(() => window.nativeUpdateEvent(JSON.stringify({ status: 'available', version: '1.22', sizeMb: 2.5, notes: '修复更新流程' })));
    assert.match(await nativeFreshPage.locator('#updatePanel').innerText(), /1\.22/);
    await nativeFreshPage.setViewportSize({ width: 320, height: 420 });
    assert.ok(await nativeFreshPage.locator('#downloadUpdate').evaluate(button => {
      const bounds=button.getBoundingClientRect();return bounds.left>=0&&bounds.right<=innerWidth&&bounds.height>=48;
    }));
    await nativeFreshPage.locator('#downloadUpdate').click();
    assert.equal(await nativeFreshPage.evaluate(() => localStorage.getItem('update_download_called')), 'yes');
    await nativeFreshPage.evaluate(() => window.nativeUpdateEvent(JSON.stringify({ status: 'progress', percent: 50 })));
    assert.equal(await nativeFreshPage.locator('progress').getAttribute('value'), '50');
    await nativeFreshPage.locator('#cancelUpdateDownload').click();
    assert.equal(await nativeFreshPage.evaluate(() => localStorage.getItem('update_cancel_called')), 'yes');
    await nativeFreshPage.evaluate(() => window.nativeUpdateEvent(JSON.stringify({ status: 'available', message: '下载已取消' })));
    assert.equal(await nativeFreshPage.locator('#downloadUpdate').isVisible(), true);
    await nativeFreshPage.evaluate(() => window.nativeUpdateEvent(JSON.stringify({ status: 'available', message: '连接 GitHub 超时；仍可重新下载此前发现的 1.22 版本' })));
    assert.match(await nativeFreshPage.locator('#updatePanel').innerText(), /连接 GitHub 超时/);
    assert.equal(await nativeFreshPage.locator('#downloadUpdate').innerText(), '重新下载');
    await nativeFreshPage.evaluate(() => window.nativeUpdateEvent(JSON.stringify({ status: 'progress', percent: 0 })));
    assert.doesNotMatch(await nativeFreshPage.locator('#updatePanel').innerText(), /连接 GitHub 超时/);
    await nativeFreshPage.evaluate(() => window.nativeUpdateEvent(JSON.stringify({ status: 'progress', percent: 0, message: '等待网络连接' })));
    assert.match(await nativeFreshPage.locator('#updatePanel').innerText(), /等待网络连接/);
    await nativeFreshPage.evaluate(() => window.nativeUpdateEvent(JSON.stringify({ status: 'error', message: '网络中断', canDownload: true })));
    assert.equal(await nativeFreshPage.locator('#downloadUpdate').innerText(), '重新下载');
    await nativeFreshPage.evaluate(() => window.nativeUpdateEvent(JSON.stringify({ status: 'downloaded', message: '下载完成，可以安装' })));
    await nativeFreshPage.locator('#installUpdate').click();
    assert.equal(await nativeFreshPage.evaluate(() => localStorage.getItem('update_install_called')), 'yes');
    assert.equal(await nativeFreshPage.evaluate(() => JSON.parse(localStorage.getItem('native_project')).books[0].name), '测试作品');
    await nativeFreshPage.locator('#closeSheet').click();
    await nativeFreshPage.locator('#archiveButton').click();
    await nativeFreshPage.locator('#shareProject').click();
    assert.equal(await nativeFreshPage.evaluate(() => JSON.parse(localStorage.getItem('shared_app')).appArchiveVersion), 1);
    await nativeFreshPage.locator('#shareHtmlProject').click();
    assert.equal(await nativeFreshPage.evaluate(() => JSON.parse(localStorage.getItem('shared_html')).appArchiveVersion), undefined);
    await nativeFresh.close();

    const pcHtml = path.resolve(__dirname, '../../AI小说生成器8.7.html');
    if (fs.existsSync(pcHtml)) {
      const pcPage = await browser.newPage();
      const pcErrors = [];
      pcPage.on('pageerror', error => pcErrors.push(error.message));
      pcPage.on('dialog', dialog => dialog.accept());
      await pcPage.goto(pathToFileURL(pcHtml).href, { waitUntil: 'domcontentloaded' });
      await pcPage.waitForFunction(() => typeof document.getElementById('backupFileInput').onchange === 'function');
      await pcPage.locator('#backupFileInput').setInputFiles({ name: 'mobile-html.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(htmlArchive)) });
      await pcPage.waitForFunction(() => document.getElementById('curBookName')?.textContent?.includes('测试作品'));
      assert.ok((await pcPage.locator('#chaptersList').innerText()).includes('第100章'));
      assert.equal(await pcPage.evaluate(() => JSON.parse(localStorage.getItem('global_characters_v2'))[0].name), '朝日奈葵');
      assert.equal(pcErrors.length, 0, pcErrors.join('\n'));
      await pcPage.close();
    }

    const context = await browser.newContext({ viewport: { width: 412, height: 958 } });
    await context.addInitScript(data => {
      if (localStorage.getItem('novel_smoke_seeded')) return;
      localStorage.setItem('novel_mobile_ui_demo_v1', JSON.stringify(data));
      localStorage.setItem('novel_mobile_api_settings_v1', JSON.stringify({ ...data.apiConfig, key: 'test-key' }));
      localStorage.setItem('novel_smoke_seeded', '1');
    }, saved);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://app.local/**', route => {
      const target = path.join(assets, new URL(route.request().url()).pathname.slice(1));
      const extension = path.extname(target);
      route.fulfill({ body: fs.readFileSync(target), contentType: extension === '.html' ? 'text/html' : extension === '.js' ? 'application/javascript' : extension === '.css' ? 'text/css' : 'application/octet-stream' });
    });
    let requestCount = 0;
    await page.route('https://api.deepseek.com/**', route => { requestCount++; route.abort(); });
    await page.goto('https://app.local/index.html');
    assert.deepEqual(await page.evaluate(() => [state.readerFontSize, state.messageFontSize]), [20, 16]);
    await page.locator('#menuButton').click();
    assert.deepEqual(await page.locator('.drawer-item[data-sheet]').evaluateAll(items => items.map(item => item.dataset.sheet)), ['books', 'actions', 'globalRoles', 'roles', 'growth', 'api', 'fontSize', 'messageFontSize', 'help', 'version']);
    assert.equal((await page.locator('.drawer-item[data-sheet="api"]').innerText()).trim(), 'AI设置');
    assert.equal(await page.locator('.drawer-label').count(), 0);
    await page.locator('[data-sheet="help"]').click();
    assert.equal(await page.locator('#sheetTitle').innerText(), '使用说明');
    assert.equal(await page.locator('.help-copy p').count(), 5);
    assert.match(await page.locator('.help-copy').innerText(), /全局角色库.*正文.*项目存档/s);
    await page.locator('#closeSheet').click();
    const original = await page.evaluate(() => localStorage.getItem('novel_mobile_ui_demo_v1'));
    const invalid = { appArchiveVersion: 1, books: [{ ...saved.books[0], chatHistory: [null] }], globalActions: [], appConfig: saved.apiConfig };
    const rejected = await page.evaluate(data => { try { restoreProject(data); return false } catch (error) { return true } }, invalid);
    assert.ok(rejected);
    assert.equal(await page.evaluate(() => localStorage.getItem('novel_mobile_ui_demo_v1')), original);

    await page.evaluate(() => {
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'novel_mobile_ui_demo_v1') throw Error('模拟磁盘写入失败');
        return originalSet.call(this, key, value);
      };
    });
    await page.locator('#newChapterButton').click();
    assert.equal(requestCount, 0);
    assert.match(await page.locator('#toast').innerText(), /未保存，已取消发送/);
    await page.reload();

    await page.locator('#menuButton').click();
    await page.locator('[data-sheet="api"]').click();
    await page.evaluate(() => {
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'novel_mobile_api_settings_v1') throw Error('模拟设置写入失败');
        return originalSet.call(this, key, value);
      };
    });
    await page.locator('#apiUrl').fill('https://example.com/chat/completions');
    await page.locator('#apiKey').fill('new-key');
    await page.locator('#apiForm button[type="submit"]').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('novel_mobile_api_settings_v1')).key), 'test-key');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('novel_mobile_api_settings_v1')).url), saved.apiConfig.url);
    await page.locator('#closeSheet').click();

    await page.evaluate(() => {
      openSheet('长浮窗', '<div style="height:2000px"></div>');
      document.querySelector('.sheet').scrollTop = 500;
      openSheet('新浮窗', '<p>新内容</p>');
    });
    assert.equal(await page.locator('.sheet').evaluate(el => el.scrollTop), 0);
    await page.locator('#closeSheet').click();

    await page.route('https://example.com/chat/completions', async route => {
      await new Promise(resolve => setTimeout(resolve, 300));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '连接成功' } }] }) });
    });
    await page.locator('#menuButton').click();
    await page.locator('[data-sheet="api"]').click();
    await page.locator('#apiUrl').fill('https://example.com/chat/completions');
    await page.locator('#apiKey').fill('race-key');
    await page.locator('#testApi').click();
    await page.locator('#apiModel').fill('changed-during-test');
    await page.locator('#apiTestStatus').getByText('测试期间设置已修改，请重新测试或保存当前设置').waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('novel_mobile_api_settings_v1')).key), 'test-key');
    await page.locator('#closeSheet').click();
    assert.equal(await page.locator('#discardBackdrop').isVisible(), true);
    await page.locator('#keepEditing').click();
    assert.equal(await page.locator('#apiModel').inputValue(), 'changed-during-test');
    assert.equal(await page.evaluate(() => window.androidBack()), true);
    await page.locator('#discardChanges').click();
    assert.equal(await page.locator('#sheetBackdrop').isHidden(), true);
    await page.reload();
    await page.locator('#menuButton').click();
    await page.locator('[data-sheet="api"]').click();
    await page.locator('#apiUrl').fill('https://example.com/chat/completions');
    await page.locator('#apiKey').fill('saved-after-test');
    await page.locator('#testApi').click();
    await page.locator('#apiTestStatus').getByText('连接及回复正常，当前设置已保存').waitFor();
    await page.locator('#closeSheet').click();
    assert.equal(await page.locator('#discardBackdrop').isHidden(), true);
    assert.equal(await page.locator('#sheetBackdrop').isHidden(), true);

    await page.locator('[data-tab="reader"]').click();
    await page.locator('#panel').evaluate(panel => { panel.scrollTop = 650; });
    await page.locator('#readerModeButton').click();
    await page.waitForFunction(() => document.getElementById('readerLoading').hidden);
    assert.equal(await page.evaluate(() => state.selectedChapterId), 'ch49');
    assert.ok(await page.evaluate(() => {
      const panel=document.getElementById('panel'),article=panel.querySelector('[data-reader-chapter="ch49"]');
      return Math.abs(article.getBoundingClientRect().top-panel.getBoundingClientRect().top-panel.querySelector('.reader-toolbar').offsetHeight)<3;
    }));
    await page.locator('#readerModeButton').click();
    assert.equal(await page.locator('#panel').evaluate(panel => panel.scrollTop), 0);
    assert.equal(await page.locator('#panel [data-reader-chapter]').getAttribute('data-reader-chapter'), 'ch49');
    await page.locator('#readerModeButton').click();
    await page.waitForFunction(() => document.getElementById('readerLoading').hidden);
    assert.equal(await page.locator('[data-reader-chapter]').count(), 7);
    await page.locator('[data-reader-chapter="ch50"]').evaluate(article => { article.scrollIntoView({ block: 'start' }); document.getElementById('panel').scrollTop += 300; });
    await page.waitForFunction(() => state.selectedChapterId === 'ch50');
    await page.locator('#readerModeButton').click();
    assert.equal(await page.locator('#panel').evaluate(panel => panel.scrollTop), 0);
    assert.equal(await page.locator('#panel [data-reader-chapter]').getAttribute('data-reader-chapter'), 'ch50');
    await page.locator('#readerModeButton').click();
    await page.waitForFunction(() => document.getElementById('readerLoading').hidden);
    assert.ok(await page.evaluate(() => {
      const panel=document.getElementById('panel'),article=panel.querySelector('[data-reader-chapter="ch50"]');
      return Math.abs(article.getBoundingClientRect().top-panel.getBoundingClientRect().top-panel.querySelector('.reader-toolbar').offsetHeight)<3;
    }));
    await page.locator('#panel').evaluate(panel => { panel.scrollTop = 0; panel.dispatchEvent(new Event('scroll')); });
    await page.waitForFunction(() => document.querySelectorAll('[data-reader-chapter]').length > 7);
    assert.equal(await page.locator('[data-reader-chapter]').count(), 10);
    await page.locator('#panel').evaluate(panel => { panel.scrollTop = panel.scrollHeight; panel.dispatchEvent(new Event('scroll')); });
    await page.waitForFunction(() => document.querySelectorAll('[data-reader-chapter]').length > 10);
    assert.equal(await page.locator('[data-reader-chapter]').count(), 13);
    await page.locator('[data-tab="messages"]').click();
    assert.equal(await page.evaluate(() => state.readerContinuous), false);
    await page.locator('[data-tab="reader"]').click();
    assert.equal(await page.locator('#readerModeButton').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#panel').evaluate(panel => panel.scrollTop), 0);
    await page.locator('#panel').evaluate(panel => { panel.scrollTop = 650; });
    await page.locator('[data-chapter="ch20"]').click();
    assert.equal(await page.locator('#panel [data-reader-chapter]').getAttribute('data-reader-chapter'), 'ch20');
    assert.equal(await page.locator('#panel').evaluate(panel => panel.scrollTop), 0);
    await page.locator('#readerModeButton').click();
    await page.waitForFunction(() => document.getElementById('readerLoading').hidden);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('novel_mobile_ui_demo_v1')).readerContinuous), false);
    await page.reload();
    assert.equal(await page.locator('#readerModeButton').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#panel').evaluate(panel => panel.scrollTop), 0);
    const exportedText = await page.evaluate(data => bookText(data), saved.books[0]);
    assert.ok(exportedText.startsWith('\uFEFF测试作品\r\n\r\n第1章 测试\r\n\r\n章节 1'));
    assert.ok(exportedText.indexOf('第1章 测试') < exportedText.indexOf('第100章 测试'));
    assert.ok(exportedText.endsWith('\r\n'));
    await page.setViewportSize({ width: 320, height: 420 });
    await page.locator('[data-tab="messages"]').click();
    await page.locator('#menuButton').click();
    await page.locator('[data-sheet="version"]').click();
    assert.equal(await page.locator('#sheetTitle').innerText(), '当前版本');
    assert.match(await page.locator('#sheetBody').innerText(), /1\.22/);
    assert.equal(await page.locator('.version-repo a').getAttribute('href'), 'https://github.com/xiaohuangya617/novel-writer-android');
    assert.ok(await page.locator('.version-repo').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await page.locator('#closeSheet').click();
    const compact = await page.evaluate(() => {
      const panel = document.querySelector('#panel').getBoundingClientRect();
      const composer = document.querySelector('.composer').getBoundingClientRect();
      const actions = [...document.querySelectorAll('.composer-actions .btn')].map(el => el.getBoundingClientRect());
      return { panelHeight: panel.height, composerBottom: composer.bottom, viewHeight: innerHeight,
        oneRow: actions.every(rect => Math.abs(rect.top - actions[0].top) < 1),
        inBounds: actions.every(rect => rect.left >= 0 && rect.right <= innerWidth) };
    });
    assert.ok(compact.panelHeight > 0 && compact.composerBottom <= compact.viewHeight + 1);
    assert.ok(compact.oneRow && compact.inBounds);
    const fullDirection = Array.from({ length: 12 }, (_, index) => `走向细节${index + 1}`).join('\n');
    await page.evaluate(outline => {
      const current = book();
      current.pendingDirections = Array.from({ length: 3 }, (_, index) => ({ title: `走向${index + 1}`, outline }));
      showDirectionChoices(current);
    }, fullDirection);
    const choices = await page.locator('.choice').evaluateAll(items => items.map(item => ({
      height: item.getBoundingClientRect().height,
      clamp: getComputedStyle(item.querySelector('span')).webkitLineClamp,
      overflow: item.querySelector('span').scrollHeight > item.querySelector('span').clientHeight
    })));
    assert.deepEqual(choices.map(item => item.height), [148, 148, 148]);
    assert.ok(choices.every(item => item.clamp === '5' && item.overflow));
    await page.locator('.choice').first().click();
    assert.ok((await page.locator('#instruction').inputValue()).includes('走向细节12'));

    const latestGrowth = Array.from({ length: 12 }, (_, index) => `最新变化${index + 1}`).join('\n');
    await page.evaluate(text => {
      book().characters = [{ id: 'growth-role', name: '测试角色', growth: [
        { chapNo: 1, text: '最早变化' }, { chapNo: 9, text: '中间记录' }, { chapNo: 2, text }
      ] }];
      growthSheet();
    }, latestGrowth);
    const growthCard = page.locator('.growth-card').first();
    assert.equal(await growthCard.getAttribute('open'), null);
    assert.equal(await growthCard.evaluate(el => el.getBoundingClientRect().height), 78);
    assert.match(await growthCard.locator('.growth-latest').innerText(), /第 2 章/);
    assert.match(await growthCard.locator('.growth-count').innerText(), /3 章成长/);
    assert.equal(await growthCard.locator('.growth-preview').evaluate(el => getComputedStyle(el).webkitLineClamp), '2');
    assert.ok(await growthCard.evaluate(el => {
      const heading=el.querySelector('.growth-heading').getBoundingClientRect();
      return [...el.querySelectorAll('.growth-heading > *')].every(item => {
        const rect=item.getBoundingClientRect();
        return Math.abs(rect.top+rect.height/2-heading.top-heading.height/2)<2;
      });
    }));
    await page.evaluate(() => {
      book().characters.push({ id: 'empty-growth-role', name: '没有成长记录的测试角色', growth: [] });
      growthSheet();
    });
    assert.deepEqual(await page.locator('.growth-card').evaluateAll(items => items.map(item => item.getBoundingClientRect().height)), [78, 78]);
    assert.equal(await page.locator('.growth-card').last().locator('.growth-preview').innerText(), '暂无成长记录');
    assert.ok(await page.locator('.growth-card').last().evaluate(el => el.querySelector('.growth-heading strong').getBoundingClientRect().right <= el.querySelector('.growth-count').getBoundingClientRect().left));
    await growthCard.locator('summary').click();
    assert.notEqual(await growthCard.getAttribute('open'), null);
    assert.equal(await growthCard.locator('.growth-entry').count(), 3);
    assert.ok((await growthCard.locator('.growth-history').innerText()).includes('最新变化12'));
    await page.locator('#closeSheet').click();
    await page.evaluate(() => {
      book().chapters.at(-1).pendingSummary = true;
      book().chapters.at(-1).summary = '';
      book().draft = '下一章';
      render();
    });
    await page.locator('#newChapterButton').click();
    assert.equal(await page.locator('#sheetTitle').innerText(), '上一章资料未完成');
    assert.equal(await page.locator('#instruction').inputValue(), '下一章');
    assert.equal(await page.locator('#completePendingSummary').isVisible(), true);
    assert.equal(await page.locator('#sendWithoutSummary').isVisible(), true);
    await page.locator('#closeSheet').click();
    assert.equal(await page.locator('#sheetBackdrop').isHidden(), true);
    await page.route('https://example.com/chat/completions', async route => {
      const request = route.request().postDataJSON();
      const isSummary = request.messages[0].content.includes('小说编辑助手');
      const content = isSummary ? '【摘要】下一章发生了事情。\n【成长】' : '# 第一章 测试新章\n\n正文内容';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }) });
    });
    await page.locator('#newChapterButton').click();
    await page.locator('#sendWithoutSummary').click();
    await page.waitForFunction(() => book().chapters.length === 101 && book().chapters.at(-1).summary === '下一章发生了事情。');
    assert.equal(await page.locator('#sheetBackdrop').isHidden(), true);
    await page.locator('#menuButton').click();
    await page.locator('[data-sheet="roles"]').click();
    await page.locator('#addRole').click();
    await page.locator('#roleName').fill('朝日奈葵');
    await page.locator('#rolePersonality').fill('谨慎但坚定');
    await page.locator('#cancelRole').click();
    assert.equal(await page.locator('#discardBackdrop').isVisible(), true);
    await page.locator('#keepEditing').click();
    assert.equal(await page.locator('#rolePersonality').inputValue(), '谨慎但坚定');
    await page.locator('#closeSheet').click();
    await page.locator('#discardChanges').click();
    assert.equal(await page.locator('#sheetBackdrop').isHidden(), true);
    await page.locator('#menuButton').click();
    await page.locator('[data-sheet="roles"]').click();
    const originalRoleCount = await page.evaluate(() => book().characters.length);
    await page.locator('#addRole').click();
    await page.locator('#roleName').fill('朝日奈葵');
    await page.locator('#roleForm button[type="submit"]').click();
    assert.equal(await page.evaluate(() => book().characters.length), originalRoleCount + 1);
    await page.locator('#addRole').click();
    await page.locator('#roleName').fill(' 朝日奈葵 ');
    await page.locator('#roleForm button[type="submit"]').click();
    assert.match(await page.locator('#toast').innerText(), /已有同名角色/);
    assert.equal(await page.evaluate(() => book().characters.length), originalRoleCount + 1);
    await page.locator('#cancelRole').click();
    await page.locator('#discardChanges').click();
    await page.locator('#addRole').click();
    await page.locator('#roleName').fill('苏晚');
    await page.locator('#roleForm button[type="submit"]').click();
    await page.locator('[data-edit-role]').last().click();
    await page.locator('#roleName').fill('朝日奈葵');
    await page.locator('#roleForm button[type="submit"]').click();
    assert.match(await page.locator('#toast').innerText(), /已有同名角色/);
    assert.deepEqual(await page.evaluate(() => book().characters.slice(-2).map(c => c.name)), ['朝日奈葵', '苏晚']);
    await page.locator('#cancelRole').click();
    await page.locator('#discardChanges').click();
    const preview = await page.evaluate(() => readableBody({ title: '第101章 新的线索', content: '# 第一章 新的线索\n\n**正文** <script>window.x=1</script>' }));
    assert.ok(preview.includes('<strong>正文</strong>'));
    assert.ok(!preview.includes('<h1>'));
    assert.ok(!preview.includes('<script>'));
    assert.deepEqual(errors, []);
    console.log('PASS: growth selection, archive validation, save failures, reader batching, TXT, compact layout and cards');

    const pendingBook = { ...saved.books[0], chatHistory: [{ role: 'user', content: '写一章', ts: Date.now() }], pendingInstruction: '写一章', draft: '写一章', pendingDirections: Array.from({length: 3}, () => ({title: '旧走向', outline: '旧内容'})) };
    const pendingProject = { ...saved, books: [pendingBook], selectedChapterId: null,
      pendingNativeTask: { requestId: 'chapter-1', bookId: 'book', phase: 'chapter', instruction: '写一章', continuation: false, label: '正在生成正文', startedAt: Date.now() } };
    const resumed = await browser.newContext({ viewport: { width: 412, height: 420 } });
    await resumed.addInitScript(data => {
      localStorage.setItem('native_project', JSON.stringify(data));
      const reply = (id, content) => setTimeout(() => window.nativeRequestComplete(id,
        JSON.stringify({ status: 200, body: JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10 } }) })), 10);
      window.AndroidBridge = {
        loadProject: () => localStorage.getItem('native_project'), hasProject: () => true,
        saveProject: json => (localStorage.setItem('native_project', json), true),
        loadApiSettings: () => JSON.stringify({ ...data.apiConfig, key: 'test-key' }),
        saveApiSettings: () => true, pageReady: () => {}, appVersion: () => '1.14',
        replayRequest: id => reply(id, '# 第一章\n\n正文内容'),
        request: id => reply(id, '【摘要】本章发生了事情。\n【成长】'),
        acknowledgeRequest: id => localStorage.setItem('acknowledged', id), cancel: () => {},
        exitApp: () => localStorage.setItem('exit_requested', '1')
      };
    }, pendingProject);
    const resumedPage = await resumed.newPage();
    resumedPage.on('pageerror', error => errors.push(error.message));
    await resumedPage.route('https://app.local/**', route => {
      const target = path.join(assets, new URL(route.request().url()).pathname.slice(1));
      const extension = path.extname(target);
      route.fulfill({ body: fs.readFileSync(target), contentType: extension === '.html' ? 'text/html' : extension === '.js' ? 'application/javascript' : extension === '.css' ? 'text/css' : 'application/octet-stream' });
    });
    await resumedPage.goto('https://app.local/index.html');
    await resumedPage.waitForFunction(() => {
      const data = JSON.parse(localStorage.getItem('native_project'));
      return data.books[0].chapters.length === 101 && !!data.books[0].chapters[100].summary && !data.pendingNativeTask;
    });
    const result = await resumedPage.evaluate(() => JSON.parse(localStorage.getItem('native_project')));
    assert.equal(result.books[0].chapters.length, 101);
    assert.equal(result.books[0].pendingDirections, undefined);
    assert.equal(result.books[0].chapters[100].summary, '本章发生了事情。');
    await resumedPage.waitForTimeout(100);
    const chapterSelection = await resumedPage.evaluate(() => {
      const list = document.getElementById('chaptersList');
      const selected = list.querySelector('.chapter-row.active');
      const viewport = list.getBoundingClientRect(), item = selected.getBoundingClientRect();
      return { id: selected.dataset.chapter, visible: item.top >= viewport.top - 1 && item.bottom <= viewport.bottom + 1 };
    });
    assert.equal(chapterSelection.id, result.books[0].chapters[100].id);
    assert.ok(chapterSelection.visible);
    await resumedPage.locator('[data-tab="reader"]').click();
    assert.equal(result.books[0].chapters[100].title, '第101章');
    assert.equal(await resumedPage.locator('#panel .reader h1').innerText(), '第101章');
    assert.equal(await resumedPage.locator('#panel .prose').innerText(), '正文内容');
    await resumedPage.locator('[data-tab="messages"]').click();
    await resumedPage.evaluate(() => createTask(book(), '正在生成正文…', 'chapter'));
    assert.equal(await resumedPage.evaluate(() => window.androidBack()), true);
    await resumedPage.locator('#keepWaiting').click();
    assert.equal(await resumedPage.evaluate(() => !!activeTask), true);
    assert.equal(await resumedPage.evaluate(() => window.androidBack()), true);
    await resumedPage.locator('#stopAndExit').click();
    assert.equal(await resumedPage.evaluate(() => !!activeTask), false);
    assert.equal(await resumedPage.evaluate(() => localStorage.getItem('exit_requested')), '1');
    assert.deepEqual(errors, []);
    await resumed.close();
    console.log('PASS: native chapter replay and summary continuation');

    const damagedSettings = await browser.newContext({ viewport: { width: 412, height: 958 } });
    await damagedSettings.addInitScript(data => {
      localStorage.setItem('native_project', JSON.stringify(data));
      window.AndroidBridge = {
        loadProject: () => localStorage.getItem('native_project'), hasProject: () => true,
        saveProject: json => (localStorage.setItem('native_project', json), true),
        loadApiSettings: () => null,
        saveApiSettings: json => (localStorage.setItem('repaired_settings', json), true),
        appVersion: () => '1.14', pageReady: () => {}, replayRequest: () => {}, request: () => {},
        acknowledgeRequest: () => {}, cancel: () => {}
      };
    }, saved);
    const damagedPage = await damagedSettings.newPage();
    damagedPage.on('pageerror', error => errors.push(error.message));
    await damagedPage.route('https://app.local/**', route => {
      const target = path.join(assets, new URL(route.request().url()).pathname.slice(1));
      const extension = path.extname(target);
      route.fulfill({ body: fs.readFileSync(target), contentType: extension === '.html' ? 'text/html' : extension === '.js' ? 'application/javascript' : extension === '.css' ? 'text/css' : 'application/octet-stream' });
    });
    await damagedPage.goto('https://app.local/index.html');
    assert.match(await damagedPage.locator('#storageError').innerText(), /AI 设置无法读取/);
    await damagedPage.locator('#instruction').fill('设置损坏时仍可保存项目');
    await damagedPage.waitForFunction(() => JSON.parse(localStorage.getItem('native_project')).books[0].draft === '设置损坏时仍可保存项目');
    await damagedPage.locator('#menuButton').click();
    await damagedPage.locator('[data-sheet="api"]').click();
    await damagedPage.locator('#apiKey').fill('repaired-key');
    await damagedPage.locator('#apiForm button[type="submit"]').click();
    assert.equal(await damagedPage.locator('#storageError').isHidden(), true);
    assert.equal(await damagedPage.evaluate(() => JSON.parse(localStorage.getItem('repaired_settings')).key), 'repaired-key');
    assert.deepEqual(errors, []);
    await damagedSettings.close();
    console.log('PASS: damaged AI settings recovery and independent project save');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
