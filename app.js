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
  let currentView = "front";

  const todayLabel = document.getElementById("todayLabel");
  const selectedListEl = document.getElementById("selectedList");
  const tapToast = document.getElementById("tapToast");
  const meatToggle = document.getElementById("meatToggle");
  const dietNote = document.getElementById("dietNote");
  const saveBtn = document.getElementById("saveBtn");
  const saveStatus = document.getElementById("saveStatus");
  const historyList = document.getElementById("historyList");
  const exportBtn = document.getElementById("exportBtn");

  todayLabel.textContent = formatDateDisplay(todayIso());

  // ---- view tabs ----
  document.querySelectorAll(".view-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentView = btn.dataset.view;
      document.querySelectorAll(".view-tab").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      document.getElementById("svg-front").classList.toggle("is-hidden", currentView !== "front");
      document.getElementById("svg-back").classList.toggle("is-hidden", currentView !== "back");
    });
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
  async function loadTodayIntoForm() {
    const entry = await getEntry(todayIso());
    selectedRegions.clear();
    if (entry) {
      for (const r of entry.regions) selectedRegions.set(r.id, { ...r });
      meatToggle.checked = !!entry.meat;
      dietNote.value = entry.dietNote || "";
    } else {
      meatToggle.checked = false;
      dietNote.value = "";
    }
    refreshRegionHighlights();
    renderSelectedList();
  }

  saveBtn.addEventListener("click", async () => {
    const entry = {
      date: todayIso(),
      regions: Array.from(selectedRegions.values()),
      meat: meatToggle.checked,
      dietNote: dietNote.value.trim(),
      updatedAt: Date.now(),
    };
    await putEntry(entry);
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
          ${entry.dietNote ? `<p>Notiz: ${entry.dietNote}</p>` : ""}
          <button type="button" class="history-delete">Eintrag löschen</button>
        </div>
      `;
      item.querySelector(".history-item-head").addEventListener("click", () => {
        item.classList.toggle("open");
      });
      item.querySelector(".history-delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (confirm(`Eintrag vom ${formatDateDisplay(entry.date)} wirklich löschen?`)) {
          await deleteEntry(entry.date);
          if (entry.date === todayIso()) await loadTodayIntoForm();
          await renderHistory();
        }
      });
      historyList.appendChild(item);
    }
  }

  // ---- CSV export ----
  function buildCsv(entries) {
    entries.sort((a, b) => (a.date < b.date ? -1 : 1));
    const header = ["Datum", "Koerperstelle", "Intensitaet_0_10", "Fleisch", "ErnaehrungsNotiz"];
    const rows = [header];
    for (const entry of entries) {
      const meat = entry.meat ? "ja" : "nein";
      const note = (entry.dietNote || "").replace(/[\r\n;]+/g, " ");
      if (entry.regions.length === 0) {
        rows.push([entry.date, "", "", meat, note]);
      } else {
        for (const r of entry.regions) {
          rows.push([entry.date, r.label, String(r.intensity), meat, note]);
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
    await loadTodayIntoForm();
    await renderHistory();
  })();
})();
