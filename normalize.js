// normalize.js
function normalizeName(s){
  if (!s) return '';
  let t = String(s);

  t = t
    .replace(/[●■□◆◇★☆◎〇◯○•‣・]/g, ' ')    // 箇条書き記号 → 空白
    .replace(/[‐－ー–—─━]/g, '-')              // ダッシュ統一
    .replace(/\u3000/g, ' ')                    // 全角スペース → 半角
    .replace(/[（）［］【】〔〕]/g, m => ({'（':'(', '）':')','［':'[','］':']','【':'[','】':']','〔':'[','〕':']'}[m]))
    .replace(/[：﹕∶]/g, ':')                   // コロン統一
    .replace(/ver\.?/gi, ' ver.');

  // 全角英数記号 → 半角
  t = t.replace(/[Ａ-Ｚａ-ｚ０-９！-／：-＠［-｀｛-～]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );

  // PF/PA/P/e のゆらぎ補正
  t = t
    .replace(/\bpf\b/gi, 'PF')
    .replace(/\bpa\b/gi, 'PA')
    .replace(/\bp\b(?![a-z])/gi, 'P')
    .replace(/\be\b(?![a-z])/gi, 'e');

  t = t.replace(/^\s*[-・.]/, '').replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/[,.;:]+$/, '').trim();
  return t;
}

function isNoiseLine(s){
  if (!s) return true;
  if (s.length <= 1) return true;
  if (!/[0-9A-Za-z\u3040-\u30FF\u4E00-\u9FFF]/.test(s)) return true; // 記号だけ
  return false;
}

if (typeof window !== 'undefined') {
  window.normalizeName = normalizeName;
  window.isNoiseLine   = isNoiseLine;
}
