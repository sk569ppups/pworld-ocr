// --- app.js の冒頭に追加 ---
function $(sel){ return document.querySelector(sel); }

document.addEventListener("DOMContentLoaded", () => {
  const btn = $("#btn-ocr");
  if (btn && !btn._wired) {
    btn._wired = true;
    btn.addEventListener("click", () => {
      console.log("[OCR] click");
      // ここでOCR処理を呼び出す関数を実行
      if (typeof runOCR === "function") {
        console.log("[OCR] start");
        runOCR();
      } else {
        console.warn("runOCR が未定義です");
      }
    });
  }
});
(() => {
  const $ = s => document.querySelector(s);
  const $img = $('#imageInput');
  const $master = $('#masterCsvInput');
  const $run = $('#btnRunOCR');
  const $dlCsv = $('#btnCsv');
  const $dlXlsx = $('#btnXlsx');
  const $status = $('#statusText');
  const $prog = $('#progress');
  const $progText = $('#progressText');
  const $tbody = $('#resultBody');

  let OCR_LINES = [];   // {raw, normalized, matched, score, method}
  let MASTER_LIST = []; // 正規化済みマスター

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const setStatus = (msg) => { if ($status) $status.textContent = msg; };
  const setProgress = (p) => {
    if ($prog) $prog.value = p;
    if ($progText) $progText.textContent = (Math.round(p * 100)) + '%';
  };
  const resetUI = () => {
    setStatus('待機中');
    setProgress(0);
    OCR_LINES = [];
    if ($tbody) $tbody.innerHTML = '';
    $dlCsv.disabled = true;
    $dlXlsx.disabled = true;
  };
  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ===== CSV ===== */
  function parseCSV(text){
    return text.split(/\r?\n/).map(r => r.trim()).filter(Boolean).map(r => {
      const m = r.split(',');
      return m[0]?.replace(/^"(.*)"$/, '$1') ?? '';
    });
  }

  /* ===== マッチング ===== */
  function lev(a,b){
    const m=a.length, n=b.length;
    const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>(i?(j?0:i):j)));
    for(let i=1;i<=m;i++){
      for(let j=1;j<=n;j++){
        const cost=a[i-1]===b[j-1]?0:1;
        dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
      }
    }
    return dp[m][n];
  }
  function matchOne(norm){
    if (!norm || MASTER_LIST.length===0) return { matched:'', score:0, method:'' };
    if (MASTER_LIST.includes(norm)) return { matched:norm, score:1, method:'exact' };
    const head = MASTER_LIST.find(x=>x.startsWith(norm));
    if (head) return { matched:head, score:0.95, method:'prefix' };
    let min=Infinity, best='';
    for(const m of MASTER_LIST){
      const d=lev(norm,m);
      if(d<min){min=d; best=m;}
    }
    const maxLen=Math.max(norm.length,best.length)||1;
    const sim=1-(min/maxLen);
    if (sim>=0.70) return { matched:best, score:sim, method:'lev' };
    return { matched:'', score:0, method:'' };
  }

  /* ===== 表描画 ===== */
  function renderTable(){
    if(!$tbody) return;
    $tbody.innerHTML='';
    OCR_LINES.forEach((r,i)=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td>${i+1}</td>
        <td>${escapeHtml(r.raw)}</td>
        <td>${escapeHtml(r.normalized)}</td>
        <td>${escapeHtml(r.matched)}</td>
        <td>${r.score? r.score.toFixed(2):''}</td>
        <td>${escapeHtml(r.method)}</td>`;
      $tbody.appendChild(tr);
    });
    $dlCsv.disabled = OCR_LINES.length===0;
    $dlXlsx.disabled = OCR_LINES.length===0;
  }

  /* ===== PDF → 画像化（window.pdfjsLib を利用） ===== */
  async function pdfFileToImageBlobs(file){
    if (!window.pdfjsLib) throw new Error('pdf.js が読み込まれていません');
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data:buf }).promise;
    const blobs=[];
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      const viewport=page.getViewport({ scale:2.0 });
      const canvas=document.createElement('canvas');
      const ctx=canvas.getContext('2d');
      canvas.width=viewport.width; canvas.height=viewport.height;
      await page.render({ canvasContext:ctx, viewport }).promise;
      // eslint-disable-next-line no-await-in-loop
      const b = await new Promise(res=>canvas.toBlob(res,'image/png',0.95));
      blobs.push(b);
    }
    return blobs;
  }

  /* ===== OCRパス（CDN固定 + フォールバック） ===== */
  const PATHS = {
    workerPath:'https://unpkg.com/tesseract.js-core@5.0.2/worker.min.js',
    corePath:  'https://unpkg.com/tesseract.js-core@5.0.2/tesseract-core.wasm.js',
    langPath:  'https://tessdata.projectnaptha.com/5'
  };
  const PATHS_FALLBACK = {
    workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.2/worker.min.js',
    corePath:  'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.2/tesseract-core.wasm.js',
    langPath:  'https://tessdata.projectnaptha.com/5'
  };

  /* ===== 前処理（拡大/ガンマ/2値化） ===== */
  async function preprocessToBlob(fileOrBlob, {maxW=2200, threshold=178, gamma=1.2}={}){
    const img = await blobToImage(fileOrBlob);
    const scale = Math.min(1, maxW / img.width);
    const W = Math.max(1, Math.floor(img.width * scale));
    const H = Math.max(1, Math.floor(img.height * scale));

    const cv=document.createElement('canvas');
    const ctx=cv.getContext('2d', { willReadFrequently:true });
    cv.width=W; cv.height=H;
    ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
    ctx.drawImage(img,0,0,W,H);

    const im=ctx.getImageData(0,0,W,H);
    const d=im.data;
    for(let i=0;i<d.length;i+=4){
      const r=d[i], g=d[i+1], b=d[i+2];
      let y=(0.299*r+0.587*g+0.114*b);
      y=255*Math.pow(y/255, 1/gamma);
      const v = y>threshold ? 255 : 0;
      d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
    }
    ctx.putImageData(im,0,0);
    return await new Promise(res=>cv.toBlob(res,'image/png',0.95));
  }
  function blobToImage(blob){
    return new Promise((res,rej)=>{
      const url=URL.createObjectURL(blob);
      const img=new Image();
      img.onload=()=>{ URL.revokeObjectURL(url); res(img); };
      img.onerror=rej;
      img.src=url;
    });
  }

  /* ===== OCR本体 ===== */
  async function ocrBlobWithFallback(blob, onProgress){
    Tesseract.setLogging(true);
    let lastErr;
    for(const P of [PATHS, PATHS_FALLBACK]){
      try{
        const worker = await Tesseract.createWorker({
          ...P,
          logger: m => {
            if (typeof m.progress === 'number') onProgress?.(m.progress);
            if (m.status) setStatus(m.status);
          }
        });
        await worker.loadLanguage('jpn+eng');
        await worker.initialize('jpn+eng');
        const { data } = await worker.recognize(blob, {
          rotateAuto:true,
          tessedit_pageseg_mode:6,          // 表寄り（箇条書きは 7）
          preserve_interword_spaces:'1',
          user_defined_dpi:'300'
        });
        await worker.terminate();
        return data.text || '';
      }catch(e){ lastErr=e; }
    }
    throw lastErr || new Error('OCR起動に失敗しました');
  }

  /* ===== 出力 ===== */
  function downloadCSV(){
    const rows=[['#','raw (OCR)','normalized（整形）','matched_master','score','method']];
    OCR_LINES.forEach((r,i)=>rows.push([i+1,r.raw,r.normalized,r.matched,r.score,r.method]));
    const csv = rows.map(r => r.map(v => (/[,"\n]/.test(String(v)) ? `"${String(v).replace(/"/g,'""')}"` : v)).join(',')).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download='pworld_ocr.csv'; a.click();
  }
  function downloadXLSX(){
    const wsData=[['#','raw (OCR)','normalized（整形）','matched_master','score','method']];
    OCR_LINES.forEach((r,i)=>wsData.push([i+1,r.raw,r.normalized,r.matched,r.score,r.method]));
    const ws=XLSX.utils.aoa_to_sheet(wsData);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'OCR');
    XLSX.writeFile(wb,'pworld_ocr.xlsx');
  }

  /* ===== イベント ===== */
  $img?.addEventListener('change', ()=>{ setStatus('ファイル選択'); setProgress(0); });
  $dlCsv?.addEventListener('click', downloadCSV);
  $dlXlsx?.addEventListener('click', downloadXLSX);

  $run?.addEventListener('click', async () => {
    resetUI();

    const imgFile = $img?.files?.[0];
    if(!imgFile){ setStatus('画像またはPDFを選択してください'); return; }

    ass.add('マスターCSV読込', async () => {
      MASTER_LIST=[];
      if ($master?.files?.[0]) {
        const txt = await $master.files[0].text();
        MASTER_LIST = parseCSV(txt).map(normalizeName).filter(Boolean);
        await sleep(10);
      }
    });

    ass.add('OCR準備', async () => {
      setProgress(0);
      await sleep(10);
    });

    ass.add('OCR処理', async () => {
      let blobs=[];
      if (/^application\/pdf$/i.test(imgFile.type)) {
        blobs = await pdfFileToImageBlobs(imgFile);
      } else if (/^image\//i.test(imgFile.type)) {
        blobs = [imgFile];
      } else {
        throw new Error('対応していないファイル形式です（画像 or PDF）');
      }

      const total=blobs.length; let done=0;
      for(const b of blobs){
        // 前処理
        // eslint-disable-next-line no-await-in-loop
        const pre = await preprocessToBlob(b, { maxW:2200, threshold:178, gamma:1.2 });
        // OCR
        // eslint-disable-next-line no-await-in-loop
        const text = await ocrBlobWithFallback(pre, p=>{
          const overall=(done+p)/Math.max(total,1);
          setProgress(Math.min(0.99, overall));
        });
        // 行展開
        const lines=text.split(/\r?\n/);
        for(const raw0 of lines){
          const raw=raw0.trim();
          if (isNoiseLine(raw)) continue;
          const normalized=normalizeName(raw);
          let matched='', score=0, method='';
          if (MASTER_LIST.length){
            const m=matchOne(normalized);
            matched=m.matched; score=m.score; method=m.method;
          }
          OCR_LINES.push({ raw, normalized, matched, score, method });
        }
        done+=1; setProgress(done/total);
        await sleep(5);
      }
    });

    ass.add('描画', async () => {
      renderTable();
      setProgress(1); setStatus('完了');
    });

    try{
      await ass.run({ onStatus:setStatus });
    }catch(e){
      console.error(e);
      setStatus('エラー: ' + (e?.message || e));
      if ($tbody){
        const tr=document.createElement('tr');
        tr.innerHTML=`<td colspan="6" style="color:#fca5a5;">${escapeHtml(String(e?.message||e))}</td>`;
        $tbody.appendChild(tr);
      }
    }
  });
})();

