(() => {
  "use strict";

  const DB_NAME = "pain-tracker";
  const STORE = "entries";
  let db;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: "date" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txStore(mode) {
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  function putEntry(entry) {
    return new Promise((resolve, reject) => {
      const req = txStore("readwrite").put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function getEntry(date) {
    return new Promise((resolve, reject) => {
      const req = txStore("readonly").get(date);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  function getAllEntries() {
    return new Promise((resolve, reject) => {
      const req = txStore("readonly").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function deleteEntry(date) {
    return new Promise((resolve, reject) => {
      const req = txStore("readwrite").delete(date);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ---- localStorage backup mirror ----
  // iOS Safari's IndexedDB has occasionally been reported to lose data even
  // for installed home-screen apps. localStorage is a separate storage
  // engine, so mirroring entries there gives a second, independent copy to
  // recover from if IndexedDB alone loses records.
  const BACKUP_KEY = "pain-tracker-backup-v1";

  function readBackup() {
    try {
      return JSON.parse(localStorage.getItem(BACKUP_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function writeBackupEntry(entry) {
    try {
      const backup = readBackup();
      backup[entry.date] = entry;
      localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
    } catch {}
  }

  function removeBackupEntry(date) {
    try {
      const backup = readBackup();
      delete backup[date];
      localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
    } catch {}
  }

  async function reconcileBackup() {
    const backup = readBackup();
    const dbEntries = await getAllEntries();
    const dbByDate = new Map(dbEntries.map((e) => [e.date, e]));
    let restored = 0;
    for (const date of Object.keys(backup)) {
      if (!dbByDate.has(date)) {
        await putEntry(backup[date]);
        dbByDate.set(date, backup[date]);
        restored++;
      }
    }
    for (const entry of dbByDate.values()) writeBackupEntry(entry);
    return restored;
  }

  function todayIso() {
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d - tz).toISOString().slice(0, 10);
  }

  function formatDateDisplay(iso) {
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y}`;
  }

  // ---- state ----
  const selectedRegions = new Map(); // id -> { id, label, intensity }
  let currentEntryDate = todayIso();

  const todayLabel = document.getElementById("todayLabel");
  const entryDateInput = document.getElementById("entryDate");
  const todayBtn = document.getElementById("todayBtn");
  const selectedListEl = document.getElementById("selectedList");
  const tapToast = document.getElementById("tapToast");
  const meatToggle = document.getElementById("meatToggle");
  const dietNote = document.getElementById("dietNote");
  const medicationNote = document.getElementById("medicationNote");
  const otherNote = document.getElementById("otherNote");
  const saveBtn = document.getElementById("saveBtn");
  const saveStatus = document.getElementById("saveStatus");
  const historyList = document.getElementById("historyList");
  const exportBtn = document.getElementById("exportBtn");

  todayLabel.textContent = formatDateDisplay(todayIso());
  entryDateInput.value = currentEntryDate;
  entryDateInput.max = todayIso();

  entryDateInput.addEventListener("change", async () => {
    currentEntryDate = entryDateInput.value || todayIso();
    await loadEntryIntoForm(currentEntryDate);
  });

  todayBtn.addEventListener("click", async () => {
    currentEntryDate = todayIso();
    entryDateInput.value = currentEntryDate;
    await loadEntryIntoForm(currentEntryDate);
  });

  // ---- region tap handling ----
  function refreshRegionHighlights() {
    document.querySelectorAll(".region").forEach((el) => {
      const id = el.dataset.region;
      el.classList.toggle("selected", selectedRegions.has(id));
    });
  }

  let toastTimer;
  function showToast(text) {
    tapToast.textContent = text;
    tapToast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => tapToast.classList.remove("show"), 1400);
  }

  function toggleRegion(id, label) {
    if (selectedRegions.has(id)) {
      selectedRegions.delete(id);
      showToast(`${label} entfernt`);
    } else {
      selectedRegions.set(id, { id, label, intensity: 5 });
      showToast(`${label} hinzugefügt`);
    }
    refreshRegionHighlights();
    renderSelectedList();
  }

  document.querySelectorAll(".region").forEach((el) => {
    el.addEventListener("click", () => {
      toggleRegion(el.dataset.region, el.dataset.label);
    });
  });

  function renderSelectedList() {
    if (selectedRegions.size === 0) {
      selectedListEl.innerHTML = '<p class="empty-hint">Noch keine Stelle ausgewählt.</p>';
      return;
    }
    selectedListEl.innerHTML = "";
    for (const region of selectedRegions.values()) {
      const row = document.createElement("div");
      row.className = "region-row";
      row.innerHTML = `
        <span class="region-name">${region.label}</span>
        <input type="range" min="0" max="10" step="1" value="${region.intensity}" aria-label="Intensität ${region.label}" />
        <span class="intensity-val">${region.intensity}</span>
        <button type="button" class="remove-btn" aria-label="Entfernen">✕</button>
      `;
      const range = row.querySelector("input[type=range]");
      const val = row.querySelector(".intensity-val");
      range.addEventListener("input", () => {
        region.intensity = Number(range.value);
        val.textContent = region.intensity;
      });
      row.querySelector(".remove-btn").addEventListener("click", () => {
        toggleRegion(region.id, region.label);
      });
      selectedListEl.appendChild(row);
    }
  }

  // ---- save ----
  async function loadEntryIntoForm(date) {
    const entry = await getEntry(date);
    selectedRegions.clear();
    if (entry) {
      for (const r of entry.regions) selectedRegions.set(r.id, { ...r });
      meatToggle.checked = !!entry.meat;
      dietNote.value = entry.dietNote || "";
      medicationNote.value = entry.medication || "";
      otherNote.value = entry.otherNote || "";
    } else {
      meatToggle.checked = false;
      dietNote.value = "";
      medicationNote.value = "";
      otherNote.value = "";
    }
    refreshRegionHighlights();
    renderSelectedList();
  }

  saveBtn.addEventListener("click", async () => {
    const entry = {
      date: currentEntryDate,
      regions: Array.from(selectedRegions.values()),
      meat: meatToggle.checked,
      dietNote: dietNote.value.trim(),
      medication: medicationNote.value.trim(),
      otherNote: otherNote.value.trim(),
      updatedAt: Date.now(),
    };
    await putEntry(entry);
    writeBackupEntry(entry);
    saveStatus.textContent = "Gespeichert ✓";
    setTimeout(() => (saveStatus.textContent = ""), 2500);
    await renderHistory();
  });

  // ---- history ----
  async function renderHistory() {
    const entries = await getAllEntries();
    entries.sort((a, b) => (a.date < b.date ? 1 : -1));
    if (entries.length === 0) {
      historyList.innerHTML = '<p class="empty-hint">Noch keine Einträge vorhanden.</p>';
      return;
    }
    historyList.innerHTML = "";
    for (const entry of entries) {
      const maxIntensity = entry.regions.reduce((m, r) => Math.max(m, r.intensity), 0);
      const item = document.createElement("div");
      item.className = "history-item";
      const regionListHtml = entry.regions
        .map((r) => `<li>${r.label}: ${r.intensity}/10</li>`)
        .join("");
      item.innerHTML = `
        <div class="history-item-head">
          <span class="history-date">${formatDateDisplay(entry.date)}</span>
          <span class="history-badges">
            ${entry.regions.length ? `<span class="badge-max">max ${maxIntensity}</span>` : ""}
            <span>${entry.meat ? "🥩" : "—"}</span>
          </span>
        </div>
        <div class="history-detail">
          ${entry.regions.length ? `<ul>${regionListHtml}</ul>` : "<p>Keine Körperstellen erfasst.</p>"}
          ${entry.dietNote ? `<p>Ernährung: ${entry.dietNote}</p>` : ""}
          ${entry.medication ? `<p>Medikamente: ${entry.medication}</p>` : ""}
          ${entry.otherNote ? `<p>Sonstiges: ${entry.otherNote}</p>` : ""}
          <button type="button" class="history-edit">Diesen Tag bearbeiten</button>
          <button type="button" class="history-delete">Eintrag löschen</button>
        </div>
      `;
      item.querySelector(".history-item-head").addEventListener("click", () => {
        item.classList.toggle("open");
      });
      item.querySelector(".history-edit").addEventListener("click", async (e) => {
        e.stopPropagation();
        currentEntryDate = entry.date;
        entryDateInput.value = entry.date;
        await loadEntryIntoForm(entry.date);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      item.querySelector(".history-delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (confirm(`Eintrag vom ${formatDateDisplay(entry.date)} wirklich löschen?`)) {
          await deleteEntry(entry.date);
          removeBackupEntry(entry.date);
          if (entry.date === currentEntryDate) await loadEntryIntoForm(currentEntryDate);
          await renderHistory();
        }
      });
      historyList.appendChild(item);
    }
  }

  // ---- CSV export ----
  function buildCsv(entries) {
    entries.sort((a, b) => (a.date < b.date ? -1 : 1));
    const header = ["Datum", "Koerperstelle", "Intensitaet_0_10", "Fleisch", "ErnaehrungsNotiz", "Medikamente", "Sonstiges"];
    const rows = [header];
    for (const entry of entries) {
      const meat = entry.meat ? "ja" : "nein";
      const note = (entry.dietNote || "").replace(/[\r\n;]+/g, " ");
      const medication = (entry.medication || "").replace(/[\r\n;]+/g, " ");
      const otherNote = (entry.otherNote || "").replace(/[\r\n;]+/g, " ");
      if (entry.regions.length === 0) {
        rows.push([entry.date, "", "", meat, note, medication, otherNote]);
      } else {
        for (const r of entry.regions) {
          rows.push([entry.date, r.label, String(r.intensity), meat, note, medication, otherNote]);
        }
      }
    }
    const csv = rows.map((row) => row.map(csvEscape).join(";")).join("\r\n");
    return "﻿" + csv;
  }

  function csvEscape(val) {
    if (/[;"\n]/.test(val)) return '"' + val.replace(/"/g, '""') + '"';
    return val;
  }

  exportBtn.addEventListener("click", async () => {
    const entries = await getAllEntries();
    if (entries.length === 0) {
      alert("Noch keine Einträge zum Exportieren vorhanden.");
      return;
    }
    const csv = buildCsv(entries);
    const filename = `muskelschmerz-tracking-${todayIso()}.csv`;
    const file = new File([csv], filename, { type: "text/csv" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Muskelschmerz-Tracking Export" });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }

    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  // ---- service worker ----
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // ---- init ----
  (async function init() {
    db = await openDb();
    const restored = await reconcileBackup();
    await loadEntryIntoForm(currentEntryDate);
    await renderHistory();
    if (restored > 0) {
      const label = restored === 1 ? "Eintrag" : "Einträge";
      saveStatus.textContent = `${restored} ${label} aus Backup wiederhergestellt ✓`;
      setTimeout(() => (saveStatus.textContent = ""), 5000);
    }
  })();
})();
