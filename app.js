// app.js — 完全版（PDF.mjs対応・誤OCR補正・賢い分割・マスター突合・入力シート出力）
import { normalizeName } from './normalize.js';

// --- PDF.js 読み込み（libs から ESM を動的 import）---
async function ensurePdfJs(){
  if (window.pdfjsLib) return window.pdfjsLib;
  const pdfjsModule = await import('./libs/pdf.mjs');
  window.pdfjsLib = pdfjsModule;
  pdfjsLib.GlobalWorkerOptions.workerSrc = './libs/pdf.worker.mjs';
  return window.pdfjsLib;
}

// ---- 要素参照 ----
const fileInput   = document.getElementById('fileInput');
const masterInput = document.getElementById('masterInput');
const dropzone    = document.getElementById('dropzone');
const runBtn      = document.getElementById('runBtn');
const dlCsvBtn    = document.getElementById('dlCsvBtn');
const dlXlsxBtn   = document.getElementById('dlXlsxBtn');
const progress    = document.getElementById('progress');
const tbody       = document.querySelector('#resultTable tbody');

// 追加（index.htmlで作ったやつ）
const storeName   = document.getElementById('storeName');
const storeGroup  = document.getElementById('storeGroup');
const acqDate     = document.getElementById('acqDate');
if (acqDate && !acqDate.value) acqDate.value = new Date().toISOString().slice(0,10); // YYYY-MM-DD

let files = [];
let resultsRows = [];
let masterCanon = [];         // 正規名（キー）
let masterAlias = new Map();  // 別名→正規名

// ---- ファイル選択/ドロップ ----
fileInput.addEventListener('change', (e)=>{
  files = Array.from(e.target.files || []);
  dropzone.classList.remove('dragover');
});
dropzone.addEventListener('click', ()=> fileInput.click());
dropzone.addEventListener('dragover', (e)=>{ e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', ()=> dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e)=>{
  e.preventDefault();
  files = Array.from(e.dataTransfer.files || []);
  dropzone.classList.remove('dragover');
});

// ---- よく出る誤OCRの自動補正（必要に応じて増やしてOK）----
function autocorrectOCR(s){
  return String(s)
    // 代表例：固有名詞のゆれ
    .replace(/新志記/g, '新世紀')
    .replace(/エバンゲリオン/g, 'エヴァンゲリオン')
    .replace(/Reゼロ|Ｒｅゼロ|ﾘｾﾞﾛ/g, 'Re:ゼロ')
    .replace(/ﾌﾞﾗｯｸ/g, 'BLACK')
    // 全角英数 → 半角 & 正規化
    .normalize('NFKC')
    // 末尾の「○台」以降は削る（台数は別管理）
    .replace(/[0-9０-９]+\s*台.*$/, '')
    .trim();
}

// ---- マスターCSV / XLSX 読込（1列目=正規名、2列目以降=別名）----
masterInput.addEventListener('change', async (e)=>{
  const f = e.target.files?.[0];
  if (!f) return;

  const ext = (f.name.split('.').pop() || '').toLowerCase();
  let rows = [];

  if (ext === 'csv') {
    const text = await f.text();
    rows = text.split(/\r?\n/).map(line => line.split(','));
  } else {
    // xlsx / xls
    const ab = await f.arrayBuffer();
    const wb = XLSX.read(ab, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  }

  masterCanon = [];
  masterAlias = new Map();
  for (let i=1; i<rows.length; i++){
    const cols = (rows[i] || []).map(c => normalizeName(autocorrectOCR(String(c||''))));
    const key = cols[0];
    if (!key) continue;
    masterCanon.push(key);
    for (let j=1; j<cols.length; j++){
      const a = cols[j];
      if (a) masterAlias.set(a, key);
    }
  }
  progress.textContent = `マスター読込: ${masterCanon.length}件`;
});

// ---- OCR 実行 ----
runBtn.addEventListener('click', async ()=>{
  if (!files.length){ alert('画像またはPDFを選択してください'); return; }
  runBtn.disabled = true; dlCsvBtn.disabled = true; dlXlsxBtn.disabled = true;
  resultsRows = []; tbody.innerHTML = ''; progress.textContent = '処理開始…';

  const allTexts = [];
  for (let i=0; i<files.length; i++){
    const f = files[i];

    // --- PDF ---
    if ((f.type || '').includes('pdf') || f.name.toLowerCase().endsWith('.pdf')){
      progress.textContent = `${f.name} を読み込み中…`;
      const arrbuf = await f.arrayBuffer();
      const pdfjs = await ensurePdfJs();
      const pdf   = await pdfjs.getDocument({ data: arrbuf }).promise;

      for (let p=1; p<=pdf.numPages; p++){
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 3.0 }); // ★ 高精細レンダリング（2→3）
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/png');
        const text = await ocrImageDataURL(dataUrl, `${f.name} p${p}/${pdf.numPages}`);
        allTexts.push(text);
      }

    // --- 画像 ---
    } else if ((f.type || '').startsWith('image/')){
      const dataUrl = await fileToDataURL(f);
      const text = await ocrImageDataURL(dataUrl, f.name);
      allTexts.push(text);

    } else {
      console.warn('未対応ファイル:', f.name);
    }
  }

  // 抽出→補正→正規化→重複除去
  const candidates = pickMachineLines(allTexts.join('\n'));
  const normalized = [...new Set(candidates.map(x => normalizeName(autocorrectOCR(x))))];

  // （任意強化）マスターがある時は“それっぽい”候補だけ残す
  const filtered = roughFilterByMaster(normalized, masterCanon);

  // マスター突合
  resultsRows = filtered.map(n => {
    let match = '', score = 0, method = '';
    if (masterAlias.size && masterAlias.has(n)){
      match = masterAlias.get(n); score = 100; method = 'alias_map';
    } else if (masterCanon.length){
      const { target, rating } = bestMatch(n, masterCanon);
      if (rating >= 0.84){ match = target; score = Math.round(rating*100); method = 'fuzzy'; }
    }
    return { raw:n, normalized:n, matched_master:match, score, method };
  });

  renderTable(resultsRows);
  progress.textContent = `抽出: ${resultsRows.length}件`;
  runBtn.disabled = false; dlCsvBtn.disabled = false; dlXlsxBtn.disabled = false;
});

// ---- OCR（進捗表示つき）---
async function ocrImageDataURL(dataUrl, label=''){
  progress.textContent = `${label} をOCR開始…`;
  try {
    const res = await Tesseract.recognize(dataUrl, 'jpn', {
      logger: m => {
        if (m.status){
          if (typeof m.progress === 'number'){
            const pct = Math.round(m.progress * 100);
            progress.textContent = `${label}：${m.status} ${pct}%`;
          } else {
            progress.textContent = `${label}：${m.status}`;
          }
        }
      }
    });
    let txt = (res?.data?.text || '').trim();

    if (!txt){
      progress.textContent = `${label} 日本語OCRで結果なし → 英数モードに切替`;
      const res2 = await Tesseract.recognize(dataUrl, 'eng', {
        logger: m => {
          if (m.status){
            if (typeof m.progress === 'number'){
              const pct = Math.round(m.progress * 100);
              progress.textContent = `${label}（英数）:${m.status} ${pct}%`;
            } else {
              progress.textContent = `${label}（英数）:${m.status}`;
            }
          }
        }
      });
      txt = (res2?.data?.text || '').trim();
    }

    progress.textContent = `${label} OCR完了`;
    return txt.replace(/\r?\n/g, '\n');
  } catch (e){
    console.error(e);
    progress.textContent = `OCRエラー：${e?.message || e}`;
    return '';
  }
}

// ---- ユーティリティ ----
function fileToDataURL(f){
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
}

// 行抽出（“機種らしさ”を見て賢く分割）
function pickMachineLines(bigText){
  // 前処理：OCRの変な記号を均す
  let txt = bigText.replace(/\r/g,'')
    .replace(/[‐-‒–—―]/g,'ー')
    .replace(/[､，]/g,'、')
    .replace(/[・･•·]/g,'・')
    .replace(/[｜|]/g,'｜')
    .replace(/[／/]/g,'／');

  const lines = txt.split('\n').map(s=>s.trim()).filter(Boolean);
  const chunks = [];
  const NG = /(設置|台数|アクセス|地図|求人|お問い合わせ|会社概要|交通|駐輪|駐車|貯玉|レート|休憩|遊技|会員|LINE|Twitter|Instagram)/;

  for (let line of lines){
    if (NG.test(line)) continue;

    // 句読点・中黒・縦線・スラッシュで一次分割
    let parts = line.split(/[・｜／、;；]+/).map(p=>p.trim()).filter(Boolean);

    // 「P/S/スマスロ」っぽい境界で再分割
    const reStart = /(?=(?:^|[^A-Za-z0-9ぁ-んァ-ヶ一-龠])(?:P|S|Ｐ|Ｓ|スマスロ))/g;
    const refined = [];
    for (const p of parts){
      const starts = [...p.matchAll(reStart)].map(m=>m.index).filter(i=>i!==undefined);
      if (starts.length > 1){
        for (let i=0;i<starts.length;i++){
          const a=starts[i], b=(i+1<starts.length)?starts[i+1]:p.length;
          refined.push(p.slice(a,b).trim());
        }
      }else{
        refined.push(p);
      }
    }

    for (let c of refined){
      c = autocorrectOCR(c)
        .replace(/\s{2,}/g,' ')
        .replace(/[※☆★◆▼▲◀▶＾~～…。・]+$/g,'')
        .trim();

      const looksLike =
        /^(?:P|S|Ｐ|Ｓ|スマスロ)/.test(c) || /[ァ-ヶｦ-ﾟ一-龠A-Za-z0-9]{3,}/.test(c);

      if (c && looksLike && c.length<=80) chunks.push(c);
    }
  }
  return [...new Set(chunks)];
}

// 検索用の“キー列”生成
function keyify(s){
  if (!s) return '';
  let t = s.normalize('NFKC')
    .replace(/[・･•·．\.\-ー_＿~～\[\]【】（）\(\)「」『』<>{}<>※☆★◆▼▲◀▶|｜／/\\,:;！!？?\s]/g, '')
    .replace(/ゃ/g,'や').replace(/ゅ/g,'ゆ').replace(/ょ/g,'よ')
    .replace(/ャ/g,'ヤ').replace(/ュ/g,'ユ').replace(/ョ/g,'ヨ')
    .replace(/っ/g,'つ').replace(/ッ/g,'ツ');
  return t.toUpperCase();
}

// （任意強化）マスターで粗フィルタ：似度0.55未満を除外
function roughFilterByMaster(names, master){
  if (!master || master.length===0) return names;
  const keep = [];
  for (const n of names){
    let ok=false;
    for (const m of master){
      if (similarity(n,m) >= 0.55){ ok=true; break; }
    }
    if (ok) keep.push(n);
  }
  return keep;
}

// 簡易ベストマッチ（バイグラムJaccard）
function bestMatch(s, arr){
  let best={target:'', rating:0};
  for (const t of arr){
    const r = similarity(s, t);
    if (r > best.rating) best = { target:t, rating:r };
  }
  return best;
}
function similarity(a,b){
  const A = new Set(ngrams(a,2)), B = new Set(ngrams(b,2));
  let inter=0; for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter/union : 0;
}
function ngrams(s,n){ const xs=[]; for(let i=0;i<s.length-(n-1);i++) xs.push(s.slice(i,i+n)); return xs; }

// 表描画（確認用テーブル）
function renderTable(rows){
  tbody.innerHTML = rows.map((r,i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${escapeHtml(r.raw)}</td>
      <td>${escapeHtml(r.normalized)}</td>
      <td>${escapeHtml(r.matched_master||'')}</td>
      <td>${r.score||''}</td>
      <td>${r.method||''}</td>
    </tr>
  `).join('');
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

// === ここから出力を“入力シート”形式に統一 ===
function buildOutputRows(){
  const store  = (storeName?.value || '').trim();
  const group  = (storeGroup?.value || '').trim();
  const ymd    = (acqDate?.value || new Date().toISOString().slice(0,10)).replaceAll('-','/'); // 2025/09/15 → 2025/09/15

  const header = ['店舗名','機種名','取得日','台数','店グループ','キー列'];
  const body = resultsRows.map(r=>{
    const name = r.matched_master || r.normalized || r.raw || '';
    const key  = keyify(name);
    return [store, name, ymd, '', group, key];
  });
  return { header, body };
}

// CSVダウンロード（UTF-8 BOM付きでExcelでも文字化けしない）
dlCsvBtn.addEventListener('click', ()=>{
  const { header, body } = buildOutputRows();
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]); // BOM
  const lines = [header].concat(body).map(cols =>
    cols.map(c => `"${String(c??'').replace(/"/g,'""')}"`).join(',')
  );
  const blob = new Blob([bom, lines.join('\r\n')], { type:'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `入力シート_${dateStamp()}.csv`;
  a.click();
});

// Excelダウンロード（入力シート）
dlXlsxBtn.addEventListener('click', ()=>{
  const { header, body } = buildOutputRows();
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  XLSX.utils.book_append_sheet(wb, ws, '入力シート');
  XLSX.writeFile(wb, `入力シート_${dateStamp()}.xlsx`);
});

function dateStamp(){
  const d=new Date(), z=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`;
}
