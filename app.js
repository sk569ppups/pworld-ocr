// app.js にそのまま差し替えOK
// 依存：Tesseract.js（window.Tesseract）、XLSX（任意）
// 依存（任意）：NameNormalizer（normalizeName / makeLooseKey があれば使用）

async function runOCR() {
  const ocrBtn   = document.getElementById("ocrBtn");
  const progress = document.getElementById("progress");
  const statusEl = document.getElementById("status");
  const pdfInput = document.getElementById("pdfFile");
  const mstInput = document.getElementById("masterFile");

  // UI helper
  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };
  const setProgress = (val) => { if (progress) progress.value = Math.max(0, Math.min(100, val)); };

  // 小ヘルパー：テキスト読込
  const readFileAsText = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });

  // 小ヘルパー：CSVダウンロード
  const downloadCSV = (filename, rows) => {
    const csv = rows.map(r => r.map(v => {
      const s = (v ?? "").toString();
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).
    join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // 小ヘルパー：行のノイズ除去
  const cleanLine = (s) => {
    if (!s) return "";
    let t = s.trim();

    // 全角→半角・表記ゆれの軽整形（NameNormalizer があれば後段で再整形）
    t = t
      .replace(/[‐－ー]/g, "-")   // ハイフン系統一
      .replace(/　/g, " ")        // 全角スペース
      .replace(/\s{2,}/g, " ");   // 連続スペース
    // 明らかなゴミ行・ページ番号・単体記号などを除外
    if (/^(\d+|[‐－ー\-–—=]+|\f)$/.test(t)) return "";
    if (/^Page\s*\d+\/?\d*/i.test(t)) return "";
    if (t.length < 2) return "";
    return t;
  };

  // 小ヘルパー：正規化器
  const normalizeName = (s) => {
    if (window.NameNormalizer && typeof NameNormalizer.normalizeName === "function") {
      return NameNormalizer.normalizeName(s);
    }
    // 簡易版（フォールバック）
    return cleanLine(s)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  };
  const makeLooseKey = (s) => {
    if (window.NameNormalizer && typeof NameNormalizer.makeLooseKey === "function") {
      return NameNormalizer.makeLooseKey(s);
    }
    // 簡易版（フォールバック）：英数とカナっぽいものだけ拾う
    const t = normalizeName(s)
      .replace(/[^0-9a-z\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\- ]/g, "");
    return t.replace(/\s+/g, "");
  };

  // ===== 入力チェック =====
  try {
    if (!pdfInput?.files?.[0]) throw new Error("PDFファイルを選択してください。");
    if (!mstInput?.files?.[0]) throw new Error("マスターCSVを選択してください。");

    const pdfFile = pdfInput.files[0];
    const mstFile = mstInput.files[0];

    // ざっくり安全チェック
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
  } catch (e) {
    setStatus(e.message || "入力チェックでエラーが発生しました。");
    if (ocrBtn) ocrBtn.disabled = false;
    throw e;
  }

  // ===== マスター読込 =====
  let masterRaw = [];
  try {
    setStatus("マスターCSVを読み込み中…");
    const text = await readFileAsText(mstInput.files[0]);
    masterRaw = text
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
    if (masterRaw.length === 0) throw new Error("マスターCSVが空のようです。");
  } catch (e) {
    setStatus("マスターCSVの読み込みに失敗しました。");
    if (ocrBtn) ocrBtn.disabled = false;
    throw e;
  }

  // ルーズキー化（重複排除）
  const masterLooseList = [];
  const masterByLoose = new Map();
  for (const m of masterRaw) {
    const lk = makeLooseKey(m);
    if (!lk) continue;
    if (!masterByLoose.has(lk)) {
      masterByLoose.set(lk, m);
      masterLooseList.push(lk);
    }
  }
  if (masterByLoose.size === 0) {
    setStatus("マスターCSVの有効な行が見つかりません。");
    if (ocrBtn) ocrBtn.disabled = false;
    return;
  }

  // ===== OCR 実行（タイムアウト付き）=====
  const TIMEOUT_MS = 8 * 60 * 1000; // 8分
  let worker;
  let ocrText = "";

  try {
    setStatus("OCRエンジンを初期化中…");
    const { createWorker } = window.Tesseract || {};
    if (!createWorker) throw new Error("Tesseract.js が読み込まれていません。");

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

    const pdfFile = pdfInput.files[0];

    // タイムアウト制御
    const recognizePromise = worker.recognize(pdfFile).then(res => res?.data?.text || "");

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("OCRがタイムアウトしました。PDFのページ数/解像度を下げて再試行してください。")), TIMEOUT_MS)
    );

    setStatus("OCRを実行中…");
    ocrText = await Promise.race([recognizePromise, timeoutPromise]);

  } catch (e) {
    console.error(e);
    setStatus(e.message || "OCR中にエラーが発生しました。");
    throw e;
  } finally {
    try { if (worker) await worker.terminate(); } catch (_) {}
    setProgress(100);
  }

  // ===== テキスト → 行配列 =====
  const lines = (ocrText || "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  if (lines.length === 0) {
    setStatus("OCRテキストが取得できませんでした。PDFの品質をご確認ください。");
    if (ocrBtn) ocrBtn.disabled = false;
    return;
  }

  // ===== 照合 =====
  setStatus("マスターと照合中…");
  const seenLoose = new Set();
  const matched = new Set();
  const unmatched = new Set();

  for (const raw of lines) {
    const lk = makeLooseKey(raw);
    if (!lk || seenLoose.has(lk)) continue;
    seenLoose.add(lk);

    if (masterByLoose.has(lk)) {
      matched.add(masterByLoose.get(lk)); // マスターの正式名で保持
    } else {
      unmatched.add(normalizeName(raw));   // 正規化済みの未登録候補
    }
  }

  // ===== 出力 =====
  try {
    setStatus("出力ファイルを作成中…");
    const header = ["分類", "機種名"];
    const rows =
      [header]
      .concat([...matched].sort().map(m => ["マッチ", m]))
      .concat([...unmatched].sort().map(u => ["未登録", u]));

    if (window.XLSX && XLSX.utils && XLSX.writeFile) {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "抽出結果");
      XLSX.writeFile(wb, "pworld_extract.xlsx");
    } else {
      // フォールバック：CSV ダウンロード
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
