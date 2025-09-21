// app.js（修正用・安全版）
// 依存：Tesseract.js（window.Tesseract）
// 任意依存：XLSX（無ければ CSV でフォールバック）
// 任意依存：NameNormalizer { normalizeName, makeLooseKey } があれば自動使用

// 入口：index.html のボタンから呼ばれます
async function startOCR() {
  const btn = document.getElementById("ocrBtn");
  const progress = document.getElementById("progress");
  const statusEl = document.getElementById("status");

  // UI 初期化
  if (progress) progress.value = 0;
  if (statusEl) statusEl.textContent = "OCRを開始します…";
  if (btn) btn.disabled = true;

  try {
    await runOCR();
  } catch (e) {
    console.error(e);
    if (statusEl) statusEl.textContent = e?.message || "エラーが発生しました。";
  } finally {
    if (btn) btn.disabled = false;
  }
}
// app.js 上部のユーティリティ付近に置く
async function ensurePdfJsLoaded() {
  if (window.pdfjsLib) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("pdf.min.js load failed"));
    document.head.appendChild(s);
  });
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.worker.min.js";
  }
}

// ===== メイン処理 =====
async function runOCR() {
  const ocrBtn   = document.getElementById("ocrBtn");
  const progress = document.getElementById("progress");
  const statusEl = document.getElementById("status");
  const pdfInput = document.getElementById("pdfFile");
  const mstInput = document.getElementById("masterFile");

  const setStatus   = (msg) => { if (statusEl) statusEl.textContent = msg; };
  const setProgress = (val) => { if (progress) progress.value = Math.max(0, Math.min(100, val)); };

  const readFileAsText = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });

  const downloadCSV = (filename, rows) => {
    const csv = rows.map(r => r.map(v => {
      const s = (v ?? "").toString();
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const cleanLine = (s) => {
    if (!s) return "";
    let t = String(s).trim();
    t = t
      .replace(/[‐－ー]/g, "-")   // ハイフン系統一
      .replace(/　/g, " ")        // 全角スペース
      .replace(/\s{2,}/g, " ");   // 連続スペース
    // ページ番号や記号のみなどのノイズ除去
    if (/^(\d+|[‐－ー\-–—=]+|\f)$/.test(t)) return "";
    if (/^Page\s*\d+\/?\d*/i.test(t)) return "";
    if (t.length < 2) return "";
    return t;
  };

  const normalizeName = (s) => {
    if (window.NameNormalizer?.normalizeName) {
      return window.NameNormalizer.normalizeName(s);
    }
    return cleanLine(s).toLowerCase().replace(/\s+/g, " ").trim();
  };

  const makeLooseKey = (s) => {
    if (window.NameNormalizer?.makeLooseKey) {
      return window.NameNormalizer.makeLooseKey(s);
    }
    const t = normalizeName(s).replace(/[^0-9a-z\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\- ]/g, "");
    return t.replace(/\s+/g, "");
  };

  // ===== 入力チェック =====
  if (!pdfInput?.files?.[0]) throw new Error("PDFファイルを選択してください。");
  if (!mstInput?.files?.[0]) throw new Error("マスターCSVを選択してください。");

  const pdfFile = pdfInput.files[0];
  const mstFile = mstInput.files[0];

  if (!/pdf$/i.test(pdfFile.name) && pdfFile.type !== "application/pdf") {
    throw new Error("PDFファイル（.pdf）を選択してください。");
  }
  const MAX_MB = 60;
  if (pdfFile.size > MAX_MB * 1024 * 1024) {
    throw new Error(`PDFサイズが大きすぎます（最大 ${MAX_MB}MB まで）。`);
  }
  if (!/\.csv$/i.test(mstFile.name)) {
    throw new Error("マスターはCSV（.csv）を選択してください。");
  }

  // ===== マスター読み込み =====
  setStatus("マスターCSVを読み込み中…");
  const masterRaw = (await readFileAsText(mstFile))
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  if (masterRaw.length === 0) throw new Error("マスターCSVが空のようです。");

  // ルーズキー化・重複排除
  const masterByLoose = new Map();
  for (const m of masterRaw) {
    const lk = makeLooseKey(m);
    if (!lk) continue;
    if (!masterByLoose.has(lk)) masterByLoose.set(lk, m);
  }
  if (masterByLoose.size === 0) throw new Error("マスターCSVの有効な行が見つかりません。");

 // ===== OCR 実行（安全版） =====
const TIMEOUT_MS = 8 * 60 * 1000; // 8分
let worker;
let ocrText = "";

setStatus("OCRエンジンを初期化中…");

// Tesseract v4 が読み込まれているか確認
const { createWorker } = window.Tesseract || {};
if (!createWorker) throw new Error("Tesseract.js が読み込まれていません。");

// PDF.js を必ず準備
await ensurePdfJsLoaded();

try {
  // logger は createWorker 側にだけ渡す（recognize には何も渡さない）
  worker = await createWorker({
    logger: (m) => {
      if (typeof m?.progress === "number") {
        setProgress(Math.round(m.progress * 100));
      }
      if (m?.status) {
        setStatus(`OCR：${m.status}…`);
      }
    }
  });
  await worker.loadLanguage("jpn");
  await worker.initialize("jpn");

  // PDF → Canvas に変換してページごとにOCR
  const buf = await pdfFile.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  setStatus("PDFを画像化中…");
  let textParts = [];
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("OCRがタイムアウトしました。PDFのページ数/解像度を下げて再試行してください。")), TIMEOUT_MS)
  );

  // ページ逐次処理（メモリ溢れ対策）
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 }); // 1.5〜2.0 で調整
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;

    setStatus(`OCRを実行中… (${i}/${pdf.numPages})`);

    // ★ここが肝：recognize に “canvas だけ” を渡す（options禁止）
    const recognizePromise = worker.recognize(canvas).then(res => res?.data?.text || "");
    const pageText = await Promise.race([recognizePromise, timeoutPromise]);
    textParts.push(pageText);

    // ページ毎にざっくり進捗（最大90%まで）
    setProgress(Math.min(90, Math.round((i / pdf.numPages) * 90)));
  }

  ocrText = textParts.join("\n");
} finally {
  try { if (worker) await worker.terminate(); } catch (_) {}
  setProgress(100);
  setStatus("OCR：完了");
}


  // ===== テキスト → 行 =====
  const lines = (ocrText || "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  if (lines.length === 0) throw new Error("OCRテキストが取得できませんでした。PDFの品質をご確認ください。");

  // ===== 照合 =====
  setStatus("マスターと照合中…");
  const seenLoose = new Set();
  const matched   = new Set();
  const unmatched = new Set();

  for (const raw of lines) {
    const lk = makeLooseKey(raw);
    if (!lk || seenLoose.has(lk)) continue;
    seenLoose.add(lk);

    if (masterByLoose.has(lk)) {
      matched.add(masterByLoose.get(lk));
    } else {
      unmatched.add(normalizeName(raw));
    }
  }

  // ===== 出力 =====
  setStatus("出力ファイルを作成中…");
  const header = ["分類", "機種名"];
  const rows =
    [header]
    .concat([...matched].sort().map(m => ["マッチ", m]))
    .concat([...unmatched].sort().map(u => ["未登録", u]));

  try {
    if (window.XLSX?.utils && XLSX.writeFile) {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "抽出結果");
      XLSX.writeFile(wb, "pworld_extract.xlsx");
    } else {
      downloadCSV("pworld_extract.csv", rows);
    }
    setStatus(`完了：マッチ ${matched.size} 件 / 未登録 ${unmatched.size} 件`);
  } catch (e) {
    console.error(e);
    setStatus("出力作成でエラーが発生しました。");
    throw e;
  } finally {
    if (ocrBtn) ocrBtn.disabled = false;
  }
}

