// app.js（トラブルシュート用・安全版 完全ファイル）
// 依存：Tesseract.js（window.Tesseract）
// 任意依存：XLSX（無ければ CSV フォールバック）
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

  // ノイズ除去（OCR行向け）
  const cleanLine = (s) => {
    if (!s) return "";
    let t = String(s).trim();
    t = t
      .replace(/[‐－ー]/g, "-")   // ハイフン系統一
      .replace(/　/g, " ")        // 全角スペース
      .replace(/\s{2,}/g, " ");   // 連続スペース
    // ページ番号・記号のみ等のノイズ
    if (/^(\d+|[‐－ー\-–—=]+|\f)$/.test(t)) return "";
    if (/^Page\s*\d+\/?\d*/i.test(t)) return "";
    if (t.length < 2) return "";
    return t;
  };

  // 正規化器（NameNormalizer があればそれを使う）
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

  // ===== OCR 実行（タイムアウト付き）=====
  const TIMEOUT_MS = 8 * 60 * 1000; // 8分
  let worker;
  let ocrText = "";

  setStatus("OCRエンジンを初期化中…");
  const { createWorker } = window.Tesseract || {};
  if (!createWorker) throw new Error("Tesseract.js が読み込まれていません。");

  try {
    worker = await createWorker({
      logger: (m) => {
        if (m.status === "recognizing text" && typeof m.progress === "number") {
          setProgress(Math.round(m.progress * 100));
        } else if (m.status) {
          setStatus(`OCR：${m.status}…`);
        }
      }
    });

    await worker.loadLanguage("jpn");
    await worker.initialize("jpn");

    const recognizePromise = worker.recognize(pdfFile).then(res => res?.data?.text || "");
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("OCRがタイムアウトしました。PDFのページ数/解像度を下げて再試行してください。")), TIMEOUT_MS)
    );

    setStatus("OCRを実行中…");
    ocrText = await Promise.race([recognizePromise, timeoutPromise]);
  } finally {
    try { if (worker) await worker.terminate(); } catch (_) {}
    setProgress(100);
  }

  // ===== テキスト → 行 =====
  const lines = (ocrText || "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);
  if (lines.length === 0) throw new Error("OCRテキストが取得できませんでした。PDFの品質をご確認ください。");

  // ===== マスター照合 =====
  setStatus("マスターと照合中…");
  const seenLoose = new Set();
  const matched   = new Set();
  const unmatched = new Set();

  for (const raw of lines) {
    const lk = makeLooseKey(raw);
    if (!lk || seenLoose.has(lk)) continue;
    seenLoose.add(lk);

    if (masterByLoose.has(lk)) {
      matched.add(masterByLoose.get(lk)); // マスター正式名で採用
    } else {
      unmatched.add(normalizeName(raw));  // 未登録候補（正規化済）
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
