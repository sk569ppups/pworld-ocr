// OCR結果をマスターシートと照合する処理
async function runOCR() {
  const fileInput = document.getElementById("pdfFile");
  const masterInput = document.getElementById("masterFile");

  if (!fileInput.files[0] || !masterInput.files[0]) {
    alert("PDFファイルとマスターCSVを選択してください");
    document.getElementById("ocrBtn").disabled = false;
    return;
  }

  // OCR処理の準備
  const { createWorker } = Tesseract;
  const worker = await createWorker({
    logger: m => {
      if (m.status === "recognizing text") {
        document.getElementById("progress").value = m.progress * 100;
      }
    }
  });

  await worker.loadLanguage("jpn");
  await worker.initialize("jpn");

  const pdfFile = fileInput.files[0];
  const { data } = await worker.recognize(pdfFile);
  await worker.terminate();

  const lines = data.text.split("\n").map(l => l.trim()).filter(Boolean);

  // マスターシート読み込み
  const masterText = await masterInput.files[0].text();
  const master = masterText.split("\n").map(l => l.trim()).filter(Boolean);

  const uniq = new Set();
  const matched = new Set();
  const unmatched = new Set();

  const masterLooseList = master.map(m => NameNormalizer.makeLooseKey(m));

  for (const raw of lines) {
    const norm = NameNormalizer.normalizeName(raw);
    const loose = NameNormalizer.makeLooseKey(raw);
    if (!loose || uniq.has(loose)) {
      console.warn("重複 or 無効:", raw); // デバッグ用
      continue;
    }
    uniq.add(loose);

    // 照合
    const idx = masterLooseList.indexOf(loose);
    if (idx !== -1) {
      matched.add(master[idx]);
    } else {
      unmatched.add(norm);
    }
  }

  // Excel出力
  const ws_data = [
    ["分類", "機種名"],
    ...[...matched].map(m => ["マッチ", m]),
    ...[...unmatched].map(u => ["未登録", u])
  ];
  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "抽出結果");
  XLSX.writeFile(wb, "pworld_extract.xlsx");
}
