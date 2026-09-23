/**
 * Aldeshia: a stateful, D20-powered fantasy RPG for a Google Apps Script Web App.
 *
 * Before deploying, set GROQ_API_KEY in Project Settings > Script properties.
 * Deploy as a web app and use the GET page or POST { action: "turn", input: "..." }.
 */

var GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
var GROQ_MODEL = 'openai/gpt-oss-120b';
var STATE_KEY = 'ALDESHIA_PLAYER_STATE_V1';
var STAGES = [
  '시작의 마을', '고블린 부락', '오크 점령지', '알데시아 사막', '해적의 만',
  '혹한의 설산', '수정광산', '요정의 숲', '황폐한 대지', '마왕의 탑'
];
var STAT_NAMES = ['STR', 'DEX', 'INT', 'CON', 'WIS', 'CHA'];
var MAX_HISTORY = 8;

function initGame() {
  var state = defaultState_();
  saveState_(state);
  return publicState_(state);
}

/** Processes one player command. All authoritative state changes happen here. */
function processTurn(userInput) {
  if (typeof userInput !== 'string' || !userInput.trim()) {
    throw new Error('행동을 입력해 주세요.');
  }
  userInput = userInput.trim().slice(0, 1000);
  var lock = LockService.getUserLock();
  if (!lock.tryLock(10000)) throw new Error('다른 행동을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
  try {
    var state = loadState_();
    if (state.game_over) throw new Error('게임이 종료되었습니다. initGame으로 새 모험을 시작하세요.');

    var roll = Math.floor(Math.random() * 20) + 1;
    var messages = buildMessages_(state, userInput, roll);
    var apiText = callGroqApi(messages);
    var gm = parseGMActions(apiText);
    applyGMActions_(state, gm.updates);
    state.history.push({ role: 'player', text: userInput });
    state.history.push({ role: 'gm', text: gm.narrative });
    state.history = state.history.slice(-MAX_HISTORY);
    saveState_(state);
    return {
      narrative: gm.narrative,
      roll: roll,
      outcome: gm.updates.outcome,
      state: publicState_(state)
    };
  } finally {
    lock.releaseLock();
  }
}

/** Calls Groq's OpenAI-compatible chat-completions endpoint. */
function callGroqApi(messages) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('GROQ_API_KEY');
  if (!apiKey) throw new Error('Script Properties에 GROQ_API_KEY를 설정해야 합니다.');
  var response;
  try {
    response = UrlFetchApp.fetch(GROQ_URL, {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + apiKey },
      payload: JSON.stringify({ model: GROQ_MODEL, messages: messages, temperature: 0.8, max_tokens: 1200 }),
      muteHttpExceptions: true
    });
  } catch (err) {
    throw new Error('Groq API에 연결할 수 없습니다: ' + err.message);
  }
  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Groq API 오류 (' + code + '): ' + body.slice(0, 400));
  }
  try {
    var data = JSON.parse(body);
    var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('빈 응답');
    return text.trim();
  } catch (err) {
    throw new Error('Groq API 응답 형식이 올바르지 않습니다: ' + err.message);
  }
}

/** Separates GM narration from its required final fenced JSON object and validates it. */
function parseGMActions(apiResponseText) {
  if (typeof apiResponseText !== 'string') throw new Error('GM 응답이 문자열이 아닙니다.');
  var match = apiResponseText.match(/```json\s*([\s\S]*?)\s*```\s*$/i);
  if (!match) throw new Error('GM 응답 마지막에 JSON 상태 블록이 없습니다. 이번 턴은 저장되지 않았습니다.');
  var updates;
  try { updates = JSON.parse(match[1]); }
  catch (err) { throw new Error('GM 상태 JSON을 읽을 수 없습니다: ' + err.message); }
  var outcomes = ['CRITICAL_SUCCESS', 'SUCCESS', 'FAILURE', 'CRITICAL_FAILURE'];
  if (outcomes.indexOf(updates.outcome) === -1) throw new Error('유효하지 않은 판정 결과입니다.');
  if (typeof updates.xp_gained !== 'number' || typeof updates.hp_change !== 'number') {
    throw new Error('GM JSON에 xp_gained 또는 hp_change가 없습니다.');
  }
  if (!Array.isArray(updates.items_added) || !Array.isArray(updates.items_removed) ||
      typeof updates.stage_cleared !== 'boolean' || !updates.stat_changes || typeof updates.stat_changes !== 'object') {
    throw new Error('GM JSON의 상태 변경 필드가 올바르지 않습니다.');
  }
  return { narrative: apiResponseText.slice(0, match.index).trim(), updates: updates };
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Untitled RPG')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Client-side google.script.run entry point. */
function getGameState() {
  return publicState_(loadState_());
}

function doPost(e) {
  try {
    var request = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : (e.parameter || {});
    var result;
    if (request.action === 'init') result = { state: initGame() };
    else if (request.action === 'state') result = { state: publicState_(loadState_()) };
    else if (request.action === 'turn') result = processTurn(request.input);
    else throw new Error('action은 init, state, turn 중 하나여야 합니다.');
    return jsonOutput_({ ok: true, result: result });
  } catch (err) {
    return jsonOutput_({ ok: false, error: err.message || String(err) });
  }
}

function buildMessages_(state, input, roll) {
  var system = [
    'You are the expert Korean GM for Aldeshia, an immersive D20 fantasy TRPG.',
    'There are exactly ten stages, in order: ' + STAGES.join(' → ') + '.',
    'Describe the player action vividly in Korean. Decide a relevant ability and a fair DC (5-25), then calculate d20 + ability modifier + matching equipped-item bonuses.',
    'The server supplied d20 is immutable. Natural 20 MUST be CRITICAL_SUCCESS and natural 1 MUST be CRITICAL_FAILURE. Otherwise SUCCESS requires total >= DC; use FAILURE otherwise.',
    'Respect the supplied inventory: do not claim a required item is present unless it is in it. Make rewards, damage, and XP proportional. Never advance more than one stage.',
    'At the VERY END return exactly one raw JSON object inside a ```json fence, with no text after it:',
    '{"outcome":"CRITICAL_SUCCESS|SUCCESS|FAILURE|CRITICAL_FAILURE","xp_gained":number,"hp_change":number,"items_added":[{"id":"safe_id","name":"name","effect":"description"}],"items_removed":["item_id"],"stage_cleared":boolean,"stat_changes":{"STR":0,"DEX":0,"INT":0,"CON":0,"WIS":0,"CHA":0}}',
    'Always include every field. Use zeros and empty arrays when there is no change. Never change level, current stage, equipment, max HP, or existing item properties directly.'
  ].join('\n');
  var context = {
    current_stage_index: state.current_stage_index,
    current_stage_name: STAGES[state.current_stage_index],
    d20_roll: roll,
    stat_modifiers: statModifiers_(state.stats),
    equipped_stat_bonuses: equippedBonuses_(state),
    player_state: publicState_(state),
    recent_history: state.history
  };
  return [{ role: 'system', content: system }, { role: 'user', content: 'PLAYER ACTION: ' + input + '\nAUTHORITATIVE CONTEXT:\n' + JSON.stringify(context) }];
}

function applyGMActions_(state, u) {
  state.xp += clampInt_(u.xp_gained, 0, 500);
  state.hp = clampInt_(state.hp + clampInt_(u.hp_change, -state.max_hp, state.max_hp), 0, state.max_hp);
  STAT_NAMES.forEach(function (stat) {
    var amount = Object.prototype.hasOwnProperty.call(u.stat_changes, stat) ? u.stat_changes[stat] : 0;
    state.stats[stat] = clampInt_(state.stats[stat] + clampInt_(amount, -2, 2), 1, 30);
  });
  u.items_removed.forEach(function (id) {
    if (typeof id === 'string') state.inventory = state.inventory.filter(function (item) { return item.id !== id; });
  });
  u.items_added.slice(0, 3).forEach(function (item) {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') return;
    var id = item.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    if (!id || state.inventory.some(function (old) { return old.id === id; })) return;
    state.inventory.push({ id: id, name: item.name.slice(0, 80), effect: String(item.effect || '').slice(0, 240) });
  });
  if (u.stage_cleared) {
    if (state.current_stage_index < STAGES.length - 1) state.current_stage_index++;
    else state.game_over = true;
  }
  while (state.xp >= state.level * 100) {
    state.xp -= state.level * 100;
    state.level++;
    state.max_hp += 5;
    state.hp = state.max_hp;
    state.stats.CON = Math.min(30, state.stats.CON + 1);
  }
}

function defaultState_() {
  return { level: 1, xp: 0, hp: 20, max_hp: 20, current_stage_index: 0, game_over: false,
    stats: { STR: 12, DEX: 12, INT: 10, CON: 12, WIS: 10, CHA: 10 },
    inventory: [{ id: 'iron_sword', name: '낡은 철검', effect: '근접 공격에 +1', bonuses: { STR: 1 } }],
    equipped: { weapon: 'iron_sword', armor: null, accessory: null }, history: [] };
}

function loadState_() {
  var raw = PropertiesService.getUserProperties().getProperty(STATE_KEY);
  if (!raw) return defaultState_();
  try { return normalizeState_(JSON.parse(raw)); }
  catch (err) { throw new Error('저장 데이터를 읽을 수 없습니다. initGame으로 초기화하세요.'); }
}
function saveState_(state) { PropertiesService.getUserProperties().setProperty(STATE_KEY, JSON.stringify(state)); }
function normalizeState_(s) {
  var fresh = defaultState_();
  if (!s || typeof s !== 'object') return fresh;
  ['level', 'xp', 'hp', 'max_hp', 'current_stage_index'].forEach(function (key) { if (typeof s[key] === 'number') fresh[key] = Math.floor(s[key]); });
  fresh.current_stage_index = clampInt_(fresh.current_stage_index, 0, STAGES.length - 1);
  fresh.level = clampInt_(fresh.level, 1, 100); fresh.max_hp = clampInt_(fresh.max_hp, 1, 999); fresh.hp = clampInt_(fresh.hp, 0, fresh.max_hp);
  if (s.stats && typeof s.stats === 'object') STAT_NAMES.forEach(function (x) { fresh.stats[x] = clampInt_(s.stats[x], 1, 30); });
  if (Array.isArray(s.inventory)) fresh.inventory = s.inventory.slice(0, 100);
  if (s.equipped && typeof s.equipped === 'object') fresh.equipped = s.equipped;
  if (Array.isArray(s.history)) fresh.history = s.history.slice(-MAX_HISTORY);
  fresh.game_over = Boolean(s.game_over); return fresh;
}
function publicState_(s) { return JSON.parse(JSON.stringify(s)); }
function statModifiers_(stats) {
  var modifiers = {};
  STAT_NAMES.forEach(function (stat) { modifiers[stat] = Math.floor((stats[stat] - 10) / 2); });
  return modifiers;
}
function equippedBonuses_(state) {
  var totals = { STR: 0, DEX: 0, INT: 0, CON: 0, WIS: 0, CHA: 0 };
  Object.keys(state.equipped || {}).forEach(function (slot) {
    var id = state.equipped[slot];
    var item = state.inventory.filter(function (candidate) { return candidate.id === id; })[0];
    if (!item || !item.bonuses || typeof item.bonuses !== 'object') return;
    STAT_NAMES.forEach(function (stat) { totals[stat] += clampInt_(item.bonuses[stat], -10, 10); });
  });
  return totals;
}
function clampInt_(value, min, max) { value = typeof value === 'number' && isFinite(value) ? Math.floor(value) : min; return Math.max(min, Math.min(max, value)); }
function jsonOutput_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
