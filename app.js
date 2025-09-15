// --- PDF.js（libs から読み込み） ---
async function ensurePdfJs(){
  if (window.pdfjsLib) return window.pdfjsLib;
  const pdfjsModule = await import('./libs/pdf.mjs');
  window.pdfjsLib = pdfjsModule;
  pdfjsLib.GlobalWorkerOptions.workerSrc = './libs/pdf.worker.mjs';
  return window.pdfjsLib;
}

const fileInput = document.getElementById('fileInput');
const runBtn    = document.getElementById('runBtn');
const dlXlsxBtn = document.getElementById('dlXlsxBtn');
const progress  = document.getElementById('progress');
const tbody     = document.querySelector('#resultTable tbody');

let files = [];
let results = [];

// ファイル選択
fileInput.addEventListener('change', e=>{
  files = Array.from(e.target.files||[]);
});

// OCR実行
runBtn.addEventListener('click', async ()=>{
  if (!files.length){ alert('PDFまたは画像を選択してください'); return; }
  runBtn.disabled = true; dlXlsxBtn.disabled = true;
  results = []; tbody.innerHTML=''; progress.textContent='処理開始…';

  const allTexts=[];
  for (const f of files){
    if ((f.type||'').includes('pdf') || f.name.toLowerCase().endsWith('.pdf')){
      // PDF → ページごとに画像化
      const arrbuf = await f.arrayBuffer();
      const pdfjs  = await ensurePdfJs();
      const pdf    = await pdfjs.getDocument({data:arrbuf}).promise;
      for (let p=1; p<=pdf.numPages; p++){
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 3.0 }); // 高精細でレンダリング
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({canvasContext:ctx, viewport}).promise;
        const dataUrl = canvas.toDataURL('image/png');
        const txt = await ocrImage(dataUrl, `${f.name} p${p}`);
        allTexts.push(txt);
      }
    }else if ((f.type||'').startsWith('image/')){
      const dataUrl = await fileToDataURL(f);
      const txt = await ocrImage(dataUrl, f.name);
      allTexts.push(txt);
    }
  }

  // 機種名らしい行だけ抽出 → 重複除去
  const candidates = pickMachineLines(allTexts.join("\n"));
  results = [...new Set(candidates)];

  render(results);
  progress.textContent=`抽出: ${results.length}件`;
  runBtn.disabled=false; dlXlsxBtn.disabled=false;
});

// OCR処理
async function ocrImage(dataUrl,label){
  progress.textContent=`${label} OCR開始…`;
  const res = await Tesseract.recognize(dataUrl,'jpn',{
    logger: m=>{
      if (m.status && typeof m.progress==='number'){
        progress.textContent = `${label} ${m.status} ${(m.progress*100).toFixed(0)}%`;
      }
    }
  });
  progress.textContent=`${label} OCR完了`;
  return res.data.text || '';
}

function fileToDataURL(f){
  return new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(f);});
}

// --- ここが“シンプルでも強い”機種抽出ロジック ---
function pickMachineLines(txt){
  // 前処理：ノイズ均し & 台数表記カット
  let t = txt.replace(/\r/g,'')
             .replace(/[‐-‒–—―]/g,'ー')
             .replace(/[､，]/g,'、')
             .replace(/[・･•·]/g,'・')
             .replace(/[｜|]/g,'｜')
             .replace(/[／/]/g,'／')
             .replace(/[0-9０-９]+\s*台.*$/gm, ''); // 行末の「○台」以降を削る

  // 行ごと
  const lines = t.split('\n').map(s=>s.trim()).filter(Boolean);

  const out = [];
  const NG = /(設置|台数|アクセス|地図|求人|お問い合わせ|会社概要|交通|駐輪|駐車|貯玉|レート|休憩|遊技|会員|LINE|Twitter|Instagram)/;

  for (let line of lines){
    if (NG.test(line)) continue;

    // 句読点・中黒・縦線・スラッシュで一次分割
    let parts = line.split(/[・｜／、;；]+/).map(p=>p.trim()).filter(Boolean);

    // P/S/スマスロの“機種スタート”っぽい境界で再分割
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
      c = c.replace(/\s{2,}/g,' ').replace(/[※☆★◆▼▲◀▶＾~～…。・]+$/g,'').trim();
      const looksLike =
        /^(?:P|S|Ｐ|Ｓ|スマスロ)/.test(c) || /[ァ-ヶｦ-ﾟ一-龠A-Za-z0-9]{3,}/.test(c);
      if (c && looksLike && c.length<=80) out.push(c);
    }
  }
  return out;
}

// 表描画
function render(arr){
  tbody.innerHTML = arr.map((x,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(x)}</td></tr>`).join('');
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

// Excel出力（xlsxは文字化けなし）
dlXlsxBtn.addEventListener('click', ()=>{
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([["機種名"], ...results.map(r=>[r])]);
  XLSX.utils.book_append_sheet(wb, ws, "機種リスト");
  XLSX.writeFile(wb, "機種リスト.xlsx");
});
