const byId = id => document.getElementById(id);
const colorNames = { red: 'Kırmızı', blue: 'Mavi', yellow: 'Sarı', green: 'Yeşil', black: 'Siyah' };
const tabId = Number(new URLSearchParams(location.search).get('tabId'));

function makeGroups(tiles) {
  const groups = [];
  const addChoices = (lists, picked = [], at = 0) => {
    if (at === lists.length) {
      if (picked.length >= 3) groups.push(picked);
      return;
    }
    for (const tileIndex of lists[at]) addChoices(lists, [...picked, tileIndex], at + 1);
  };

  // Runs: same color, consecutive numbers, at least three tiles.
  const normal = tiles.map((tile, index) => ({ ...tile, index })).filter(tile => !tile.wild && tile.value > 0);
  const colors = [...new Set(normal.map(tile => tile.color))];
  for (const color of colors) {
    const values = new Map();
    for (const tile of normal.filter(item => item.color === color)) {
      if (!values.has(tile.value)) values.set(tile.value, []);
      values.get(tile.value).push(tile.index);
    }
    for (let start = 1; start <= 13; start++) {
      const lists = [];
      for (let end = start; end <= 13; end++) {
        const options = values.get(end);
        if (!options) break;
        lists.push(options);
        if (lists.length >= 3) addChoices(lists);
      }
    }
  }

  // Sets: three or four different colors with the same number.
  for (let value = 1; value <= 13; value++) {
    const perColor = new Map();
    for (const tile of normal.filter(item => item.value === value)) {
      if (!perColor.has(tile.color)) perColor.set(tile.color, []);
      perColor.get(tile.color).push(tile.index);
    }
    const entries = [...perColor.values()];
    const pickColors = (start, needed, picked = []) => {
      if (!needed) { addChoices(picked); return; }
      for (let i = start; i <= entries.length - needed; i++) pickColors(i + 1, needed - 1, [...picked, entries[i]]);
    };
    pickColors(0, 3);
    if (entries.length >= 4) pickColors(0, 4);
  }
  const seen = new Set();
  return groups.filter(group => {
    const key = group.slice().sort((a, b) => a - b).join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recommendDiscard(tiles) {
  const groups = makeGroups(tiles);
  const inMeld = new Set(groups.flat());
  const ranked = tiles.map((tile, index) => {
    if (tile.wild || tile.value === 0) return { index, score: -100, tile };
    const fullMeld = inMeld.has(index);
    let links = 0;
    for (let otherIndex = 0; otherIndex < tiles.length; otherIndex++) {
      if (otherIndex === index) continue;
      const other = tiles[otherIndex];
      if (other.wild || other.value === 0) continue;
      if (tile.color === other.color) {
        const gap = Math.abs(tile.value - other.value);
        if (gap === 1) links += 1.6;
        else if (gap === 2) links += 0.55;
      }
      if (tile.value === other.value && tile.color !== other.color) links += 1.15;
    }
    const score = fullMeld ? -8 - tile.value / 100 : tile.value - Math.min(links, 4) * 2.25;
    return { index, score, tile, fullMeld, links };
  });
  ranked.sort((a, b) => b.score - a.score);
  return { choice: ranked[0], meldCount: groups.length };
}

function tileLabel(tile) {
  return tile.value === 0 ? 'Sahte Okey' : `${colorNames[tile.color] || tile.color} ${tile.value}`;
}

function showHand(tiles) {
  const hand = byId('hand');
  hand.replaceChildren();
  tiles.forEach(tile => {
    const chip = document.createElement('span');
    chip.className = `tile ${tile.color}${tile.wild ? ' wild' : ''}`;
    chip.textContent = tile.value === 0 ? 'R' : String(tile.value);
    chip.title = tileLabel(tile) + (tile.wild ? ' · Okey' : '');
    hand.append(chip);
  });
  byId('count').textContent = `${tiles.length} taş`;
  byId('hand-panel').hidden = false;
}

function explain(choice, tiles) {
  const tile = choice.tile;
  if (tile.value === 0) return 'Sahte okeyi şimdilik elde tut; hangi değeri temsil ettiğini gösterge taşına göre ayrıca değerlendireceğiz.';
  if (choice.fullMeld) return 'Bu taş bir seri veya setin parçası; başka bir aday varsa onu atmayı düşün.';
  if (choice.links < 0.1) return `${tile.value} değeri yüksek ve şu an seri/set bağlantısı görünmüyor; elden çıkarmak elde kalabilecek puanı azaltır.`;
  return `Bu taşın seri/set bağlantısı zayıf (${Math.round(choice.links * 10) / 10}); diğer taşlar daha fazla tamamlanma ihtimali taşıyor.`;
}

async function scanAndAnalyze() {
  const status = byId('status');
  const button = byId('scan');
  status.className = 'status busy';
  status.textContent = 'Istaka okunuyor ve taş bağlantıları hesaplanıyor…';
  button.disabled = true;
  byId('recommendation').hidden = true;
  try {
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Okey sekmesini bulamadım. Oyun sekmesinde uzantı simgesine yeniden bas.');
    let response;
    try {
      response = await chrome.tabs.sendMessage(tabId, { type: 'READ_OKEY_HAND' });
    } catch (connectionError) {
      const sourceTab = await chrome.tabs.get(tabId);
      if (!/rekoroyun\.com\/(?:okey\.html|embed\/okey\/)/i.test(sourceTab.url || '')) throw connectionError;
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['okey-content.js'] });
      } catch (injectError) {
        throw new Error(`Taş okuyucu oyun sekmesine yüklenemedi: ${injectError?.message || injectError}`);
      }
      try {
        response = await chrome.tabs.sendMessage(tabId, { type: 'READ_OKEY_HAND' });
      } catch (replyError) {
        throw new Error(`Okuyucu eklendi ama yanıt vermedi: ${replyError?.message || replyError}`);
      }
    }
    if (response?.error) throw new Error(response.error);
    if (!response?.tiles?.length) throw new Error('Istakadaki taşları okuyamadım. Oyun başladıktan sonra yeniden dene.');
    showHand(response.tiles);
    const result = recommendDiscard(response.tiles);
    const chosen = result.choice.tile;
    byId('discard').textContent = tileLabel(chosen);
    byId('reason').textContent = explain(result.choice, response.tiles);
    byId('recommendation').hidden = false;
    status.className = 'status';
    status.textContent = `Istaka okundu (${response.count} taş). Olası seri/set bağlantıları değerlendirildi.`;
  } catch (error) {
    status.className = 'status error';
    const message = error?.message || String(error);
    status.textContent = /Receiving end does not exist|Could not establish connection/i.test(message)
      ? `Oyun sekmesiyle bağlantı kurulamadı. Ayrıntı: ${message}`
      : message;
  } finally {
    button.disabled = false;
  }
}

byId('scan').addEventListener('click', scanAndAnalyze);
byId('close').addEventListener('click', async () => {
  const current = await chrome.windows.getCurrent();
  if (current.id != null) chrome.windows.remove(current.id);
});
