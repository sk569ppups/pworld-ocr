// app.js — 完全版（Illegal return対策済み）
import { normalizeName } from './normalize.js';

const fileInput  = document.getElementById('fileInput');
const masterInput= document.getElementById('masterInput');
const dropzone   = document.getElementById('dropzone');
const runBtn     = document.getElementById('runBtn');
const dlCsvBtn   = document.getElementById('dlCsvBtn');
const dlXlsxBtn  = document.getElementById('dlXlsxBtn');
const progress   = document.getElementById('progress');
const tbody      = document.querySelector('#resultTable tbody');

let files = [];
let resultsRows = [];
let masterCanon = [];         // 正規名（キー）
let masterAlias = new Map();  // 別名→正規名

// --- ファイル選択/ドロップ ---
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

// --- マスターCSV 読込（任意） ---
masterInput.addEventListener('change', async (e)=>{
  const f = e.target.files?.[0];
  if (!f) return;
  const text = await f.text();
  const rows = text.split(/\r?\n/).map(line => line.split(','));
  masterCanon = [];
  masterAlias = new Map();
  for (let i=1; i<rows.length; i++){
    const cols = rows[i].map(c => normalizeName(String(c||'')));
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

// --- OCR 実行 ---
runBtn.addEventListener('click', async ()=>{
  if (!files.length){ alert('画像またはPDFを選択してください'); return; }
  runBtn.disabled = true; dlCsvBtn.disabled = true; dlXlsxBtn.disabled = true;
  resultsRows = []; tbody.innerHTML = ''; progress.textContent = '処理開始…';

  const allTexts = [];
  for (let i=0; i<files.length; i++){
    const f = files[i];
    if ((f.type || '').includes('pdf') || f.name.toLowerCase().endsWith('.pdf')){
      progress.textContent = `${f.name} を読み込み中…`;
      const arrbuf = await f.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrbuf }).promise;
      for (let p=1; p<=pdf.numPages; p++){
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/png');
        const text = await ocrImageDataURL(dataUrl, `${f.name} p${p}/${pdf.numPages}`);
        allTexts.push(text);
      }
    } else if ((f.type || '').startsWith('image/')){
      const dataUrl = await fileToDataURL(f);
      const text = await ocrImageDataURL(dataUrl, f.name);
      allTexts.push(text);
    } else {
      console.warn('未対応ファイル:', f.name);
    }
  }

  // 抽出→整形→重複除去
  const candidates = pickMachineLines(allTexts.join('\n'));
  const normalized = [...new Set(candidates.map(normalizeName))];

  // マスター突合（任意）
  resultsRows = normalized.map(n => {
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

// --- OCR（進捗表示つき）---
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

// --- ユーティリティ ---
function fileToDataURL(f){
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
}

// 行抽出（“機種らしさ”フィルタ）
function pickMachineLines(bigText){
  const lines = bigText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const out = [];
  const ng = /(設置|台数|アクセス|地図|求人|お問い合わせ|会社概要|交通|駐輪|駐車|貯玉|レート|休憩|遊技|会員)/;
  for (const line of lines){
    if (ng.test(line)) continue;
    if (/^(?:P|S|e|スマスロ)/.test(line) || /[ァ-ヶｦ-ﾟ一-龠A-Za-z0-9]{3,}/.test(line)){
      const t = line.replace(/\s{2,}/g,' ').replace(/[|｜◆▼▲◀▶★☆※]+/g,'').trim();
      if (t.length >= 2 && t.length <= 80) out.push(t);
    }
  }
  return [...new Set(out)];
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

// 表描画
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

// CSV/XLSX ダウンロード
dlCsvBtn.addEventListener('click', ()=>{
  const header = ['raw','normalized','matched_master','score','method'];
  const lines = [header.join(',')].concat(
    resultsRows.map(r => header.map(k => `"${String(r[k]??'').replace(/"/g,'""')}"`).join(','))
  );
  const blob = new Blob([lines.join('\r\n')], { type:'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `machines_${dateStamp()}.csv`;
  a.click();
});
dlXlsxBtn.addEventListener('click', ()=>{
  const header = ['raw','normalized','matched_master','score','method'];
  const data = [header].concat(resultsRows.map(r => header.map(k => r[k]??'')));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Normalized');
  XLSX.writeFile(wb, `machines_${dateStamp()}.xlsx`);
});
function dateStamp(){
  const d=new Date(), z=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`;
}
