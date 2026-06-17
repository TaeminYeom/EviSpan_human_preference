const DATASETS = [
  {
    id: "wmt22_en-de",
    label: "WMT22 English-German",
    evispanUrl: "../data/wmt22_en-de/0504_3.jsonl",
    remedyUrl: "../data/wmt22_en-de/remedy-r.jsonl"
  },
  {
    id: "wmt22_zh-en",
    label: "WMT22 Chinese-English",
    evispanUrl: "../data/wmt22_zh-en/0504_3.jsonl",
    remedyUrl: "../data/wmt22_zh-en/remedy-r.jsonl"
  }
];

const MODEL_LABELS = {
  evispan: "EviSpan",
  remedy: "Remedy-R"
};

const STORAGE_PREFIX = "mt-rationale-preference-v1";
const SESSION_KEY = `${STORAGE_PREFIX}:session`;
const META_KEY = `${STORAGE_PREFIX}:meta`;

const state = {
  datasetId: DATASETS[0].id,
  allCases: [],
  orderedCases: [],
  annotations: {},
  currentIndex: 0,
  loading: true
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  initControls();
  loadDataset();
});

function bindElements() {
  Object.assign(els, {
    datasetSelect: document.querySelector("#datasetSelect"),
    participantInput: document.querySelector("#participantInput"),
    orderSelect: document.querySelector("#orderSelect"),
    hideScoresInput: document.querySelector("#hideScoresInput"),
    datasetStatus: document.querySelector("#datasetStatus"),
    progressText: document.querySelector("#progressText"),
    aWinsText: document.querySelector("#aWinsText"),
    bWinsText: document.querySelector("#bWinsText"),
    tiesText: document.querySelector("#tiesText"),
    caseTitle: document.querySelector("#caseTitle"),
    caseMeta: document.querySelector("#caseMeta"),
    sourceText: document.querySelector("#sourceText"),
    translationText: document.querySelector("#translationText"),
    referenceText: document.querySelector("#referenceText"),
    responseA: document.querySelector("#responseA"),
    responseB: document.querySelector("#responseB"),
    aSideLabel: document.querySelector("#aSideLabel"),
    bSideLabel: document.querySelector("#bSideLabel"),
    confidenceInput: document.querySelector("#confidenceInput"),
    notesInput: document.querySelector("#notesInput"),
    prevBtn: document.querySelector("#prevBtn"),
    nextBtn: document.querySelector("#nextBtn"),
    exportCsvBtn: document.querySelector("#exportCsvBtn"),
    exportJsonBtn: document.querySelector("#exportJsonBtn"),
    resetBtn: document.querySelector("#resetBtn"),
    preferenceButtons: Array.from(document.querySelectorAll(".preference-button")),
    reasonInputs: Array.from(document.querySelectorAll(".reason-row input[type='checkbox']"))
  });
}

function initControls() {
  const meta = loadMeta();

  for (const dataset of DATASETS) {
    const option = document.createElement("option");
    option.value = dataset.id;
    option.textContent = dataset.label;
    els.datasetSelect.append(option);
  }

  els.datasetSelect.value = meta.datasetId || state.datasetId;
  state.datasetId = els.datasetSelect.value;
  els.participantInput.value = meta.participantId || "";
  els.orderSelect.value = meta.order || "random";
  els.hideScoresInput.checked = meta.hideScores !== false;

  els.datasetSelect.addEventListener("change", () => {
    state.datasetId = els.datasetSelect.value;
    saveMeta();
    loadDataset();
  });

  let participantTimer = null;
  els.participantInput.addEventListener("input", () => {
    saveMeta();
    window.clearTimeout(participantTimer);
    participantTimer = window.setTimeout(() => {
      state.annotations = loadAnnotations();
      buildCaseOrder();
      state.currentIndex = 0;
      render();
    }, 350);
  });

  els.orderSelect.addEventListener("change", () => {
    saveMeta();
    buildCaseOrder();
    state.currentIndex = 0;
    render();
  });

  els.hideScoresInput.addEventListener("change", () => {
    saveMeta();
    renderResponses();
  });

  els.preferenceButtons.forEach((button) => {
    button.addEventListener("click", () => setPreference(button.dataset.preference));
  });

  els.reasonInputs.forEach((input) => {
    input.addEventListener("change", () => {
      updateCurrentAnnotation({ reason_tags: getSelectedReasonTags() });
    });
  });

  els.confidenceInput.addEventListener("input", () => {
    updateCurrentAnnotation({ confidence: Number(els.confidenceInput.value) });
  });

  els.notesInput.addEventListener("input", () => {
    updateCurrentAnnotation({ notes: els.notesInput.value });
  });

  els.prevBtn.addEventListener("click", () => moveCase(-1));
  els.nextBtn.addEventListener("click", () => moveCase(1));
  els.exportCsvBtn.addEventListener("click", exportCsv);
  els.exportJsonBtn.addEventListener("click", exportJson);
  els.resetBtn.addEventListener("click", resetCurrentAnnotations);

  document.addEventListener("keydown", handleKeyboard);
}

async function loadDataset() {
  const dataset = getDataset();
  state.loading = true;
  state.allCases = [];
  state.orderedCases = [];
  state.currentIndex = 0;
  renderLoading(`Loading ${dataset.label}...`);

  try {
    const [evispanRows, remedyRows] = await Promise.all([
      fetchJsonl(dataset.evispanUrl),
      fetchJsonl(dataset.remedyUrl)
    ]);

    state.allCases = mergeRows(dataset, evispanRows, remedyRows);
    state.annotations = loadAnnotations();
    state.loading = false;
    buildCaseOrder();
    render();
  } catch (error) {
    state.loading = false;
    renderLoadError(error);
  }
}

async function fetchJsonl(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${url}: ${response.status}`);
  }
  const text = await response.text();
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseJsonlLine(line, url, index + 1));
}

function parseJsonlLine(line, url, lineNumber) {
  try {
    return JSON.parse(line);
  } catch (firstError) {
    const repaired = repairBrokenSourceField(line);
    if (repaired) {
      try {
        return JSON.parse(repaired);
      } catch (secondError) {
        console.warn(`Repair failed for ${url}:${lineNumber}`, secondError);
      }
    }
    console.warn(`Parse failed for ${url}:${lineNumber}`, firstError);
    return parseKnownFields(line);
  }
}

function repairBrokenSourceField(line) {
  const nextKeys = ["hypothesis", "reference", "target_clean"];
  for (const nextKey of nextKeys) {
    const pattern = new RegExp(`"source"\\s*:\\s*"([\\s\\S]*?),\\s*"${nextKey}"\\s*:`);
    const match = line.match(pattern);
    if (!match) continue;

    let source = match[1];
    if (source.endsWith('"')) {
      source = source.slice(0, -1);
    }
    const replacement = `"source":${JSON.stringify(source)},"${nextKey}":`;
    return line.slice(0, match.index) + replacement + line.slice(match.index + match[0].length);
  }
  return "";
}

function parseKnownFields(line) {
  return {
    source: extractStringField(line, "source"),
    hypothesis: extractStringField(line, "hypothesis"),
    reference: extractStringField(line, "reference"),
    target_clean: extractStringField(line, "target_clean"),
    src_lang: extractStringField(line, "src_lang"),
    tgt_lang: extractStringField(line, "tgt_lang"),
    lp: extractStringField(line, "lp"),
    system: extractStringField(line, "system"),
    full_response: extractStringField(line, "full_response"),
    generated_score: extractNumberField(line, "generated_score"),
    quality_score: extractNumberField(line, "quality_score"),
    seg_id: extractNumberField(line, "seg_id"),
    answer: extractAnswerField(line)
  };
}

function extractStringField(line, key) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,\\s*"|})`);
  const match = line.match(pattern);
  if (!match) return "";
  return safeJsonString(match[1]);
}

function extractNumberField(line, key) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`);
  const match = line.match(pattern);
  return match ? Number(match[1]) : "";
}

function extractAnswerField(line) {
  const marker = '"answer":';
  const start = line.indexOf(marker);
  const promptStart = line.indexOf(',"prompt"', start);
  if (start < 0 || promptStart < 0) return {};

  const json = line.slice(start + marker.length, promptStart);
  try {
    return JSON.parse(json);
  } catch (error) {
    return {};
  }
}

function safeJsonString(value) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch (error) {
    return value;
  }
}

function mergeRows(dataset, evispanRows, remedyRows) {
  const remedyBySegId = new Map();
  remedyRows.forEach((row, index) => {
    remedyBySegId.set(String(row.seg_id ?? `row-${index}`), row);
  });

  return evispanRows
    .map((evispanRow, index) => {
      const segId = evispanRow.seg_id ?? remedyRows[index]?.seg_id ?? index + 1;
      const remedyRow = remedyBySegId.get(String(segId)) || remedyRows[index] || {};
      const translation = firstText(
        evispanRow.hypothesis,
        remedyRow.target_clean,
        evispanRow.target_clean,
        remedyRow.hypothesis
      );

      return {
        id: `${dataset.id}:${segId}`,
        dataset_id: dataset.id,
        dataset_label: dataset.label,
        seg_id: segId,
        original_index: index + 1,
        system: firstText(evispanRow.system, remedyRow.system),
        source: firstText(evispanRow.source, remedyRow.source),
        translation,
        reference: firstText(evispanRow.reference, remedyRow.reference),
        lp: firstText(remedyRow.lp, makeLanguagePair(remedyRow, evispanRow)),
        src_lang: firstText(remedyRow.src_lang, evispanRow.src_lang),
        tgt_lang: firstText(remedyRow.tgt_lang, evispanRow.tgt_lang),
        outputs: {
          evispan: normalizeEvispan(evispanRow),
          remedy: normalizeRemedy(remedyRow)
        }
      };
    })
    .filter((item) => item.outputs.evispan && item.outputs.remedy);
}

function firstText(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value);
    }
  }
  return "";
}

function makeLanguagePair(...rows) {
  for (const row of rows) {
    if (row?.src_lang && row?.tgt_lang) return `${row.src_lang}-${row.tgt_lang}`;
  }
  return "";
}

function normalizeEvispan(row) {
  const answer = row.answer || {};
  return {
    model: "evispan",
    kind: "structured_spans",
    annotated_translation: firstText(answer.annotated_translation, row.hypothesis, row.target_clean),
    errors: Array.isArray(answer.errors) ? answer.errors : [],
    rationale: firstText(answer.rationale, row.rationale),
    score: firstText(answer.score, row.score)
  };
}

function normalizeRemedy(row) {
  return {
    model: "remedy",
    kind: "free_response",
    full_response: firstText(row.full_response, row.response, row.answer),
    score: firstText(row.generated_score, row.quality_score, row.score)
  };
}

function buildCaseOrder() {
  let cases = state.allCases.slice();
  const seed = `${getParticipantKey()}|${state.datasetId}`;

  if (els.orderSelect.value === "random" || els.orderSelect.value === "unanswered") {
    cases = seededOrder(cases, seed);
  }

  if (els.orderSelect.value === "unanswered") {
    cases.sort((a, b) => Number(isComplete(a.id)) - Number(isComplete(b.id)));
  }

  state.orderedCases = cases;
}

function seededOrder(items, seed) {
  return items
    .map((item) => ({ item, rank: hashString(`${seed}|${item.id}`) }))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.item);
}

function getMapping(item) {
  const swap = hashString(`${getParticipantKey()}|${state.datasetId}|${item.id}|side`) % 2 === 1;
  return swap ? { A: "remedy", B: "evispan" } : { A: "evispan", B: "remedy" };
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function renderLoading(message) {
  els.datasetStatus.textContent = message;
  els.progressText.textContent = "0 / 0";
  els.caseTitle.textContent = "Loading";
  els.caseMeta.replaceChildren();
  els.sourceText.textContent = "";
  els.translationText.textContent = "";
  els.referenceText.textContent = "";
  setEmptyResponse(els.responseA, "Loading response A");
  setEmptyResponse(els.responseB, "Loading response B");
}

function renderLoadError(error) {
  els.datasetStatus.textContent = error.message;
  els.caseTitle.textContent = "Dataset unavailable";
  els.caseMeta.replaceChildren();
  els.sourceText.textContent = "Run a local web server from the repository root, then open /qual_eval/.";
  els.translationText.textContent = "";
  els.referenceText.textContent = "";
  setEmptyResponse(els.responseA, "No response loaded");
  setEmptyResponse(els.responseB, "No response loaded");
}

function render() {
  if (state.loading) return;
  saveMeta();
  renderProgress();

  const item = getCurrentCase();
  if (!item) {
    els.datasetStatus.textContent = "No paired cases found.";
    els.caseTitle.textContent = "No case loaded";
    els.caseMeta.replaceChildren();
    els.sourceText.textContent = "";
    els.translationText.textContent = "";
    els.referenceText.textContent = "";
    setEmptyResponse(els.responseA, "No response loaded");
    setEmptyResponse(els.responseB, "No response loaded");
    renderDecision();
    return;
  }

  els.datasetStatus.textContent = `${getDataset().label}: ${state.allCases.length} paired cases`;
  els.caseTitle.textContent = `${state.currentIndex + 1} / ${state.orderedCases.length}`;
  renderCaseMeta(item);
  els.sourceText.textContent = item.source || "(empty)";
  els.translationText.textContent = item.translation || "(empty)";
  els.referenceText.textContent = item.reference || "(empty)";
  renderResponses();
  renderDecision();
}

function renderCaseMeta(item) {
  els.caseMeta.replaceChildren();
  const parts = [
    item.lp,
    item.system ? `MT: ${item.system}` : "",
    `seg_id: ${item.seg_id}`
  ].filter(Boolean);

  for (const part of parts) {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = part;
    els.caseMeta.append(pill);
  }
}

function renderResponses() {
  const item = getCurrentCase();
  if (!item) return;

  const mapping = getMapping(item);
  renderOutput(els.responseA, item.outputs[mapping.A]);
  renderOutput(els.responseB, item.outputs[mapping.B]);
  els.aSideLabel.textContent = "Left";
  els.bSideLabel.textContent = "Right";
}

function renderOutput(container, output) {
  container.replaceChildren();
  if (!output) {
    setEmptyResponse(container, "Missing output");
    return;
  }

  if (output.kind === "structured_spans") {
    renderStructuredOutput(container, output);
    return;
  }

  renderFreeResponse(container, output);
}

function renderStructuredOutput(container, output) {
  const annotatedSection = addResponseSection(container, "Annotated translation");
  const annotatedText = document.createElement("p");
  annotatedText.className = "annotated-text";
  renderAnnotatedText(annotatedText, output.annotated_translation || "");
  annotatedSection.append(annotatedText);

  const errorsSection = addResponseSection(container, "Errors");
  if (output.errors.length) {
    const list = document.createElement("ol");
    list.className = "error-list";
    output.errors.forEach((error, index) => {
      const item = document.createElement("li");
      const category = firstText(error.category, error.type, "unknown");
      const severity = firstText(error.severity, "unknown");
      item.textContent = `v${index} | ${category} | ${severity}`;
      list.append(item);
    });
    errorsSection.append(list);
  } else {
    appendEmpty(errorsSection, "No errors listed");
  }

  const rationaleSection = addResponseSection(container, "Rationale");
  const rationale = document.createElement("p");
  rationale.textContent = output.rationale || "No rationale provided";
  rationaleSection.append(rationale);

  if (!els.hideScoresInput.checked && output.score !== "") {
    const scoreSection = addResponseSection(container, "Score");
    const score = document.createElement("span");
    score.className = "score-chip";
    score.textContent = String(output.score);
    scoreSection.append(score);
  }
}

function renderFreeResponse(container, output) {
  const responseSection = addResponseSection(container, "Full response");
  const pre = document.createElement("pre");
  const text = output.full_response || "No response provided";
  pre.textContent = els.hideScoresInput.checked ? redactScores(text) : text;
  responseSection.append(pre);

  if (!els.hideScoresInput.checked && output.score !== "") {
    const scoreSection = addResponseSection(container, "Parsed score");
    const score = document.createElement("span");
    score.className = "score-chip";
    score.textContent = String(output.score);
    scoreSection.append(score);
  }
}

function renderAnnotatedText(container, text) {
  container.replaceChildren();
  const pattern = /<v(\d+)>([\s\S]*?)<\/v\1>/g;
  let cursor = 0;
  let match = pattern.exec(text);

  while (match) {
    if (match.index > cursor) {
      container.append(document.createTextNode(text.slice(cursor, match.index)));
    }
    const span = document.createElement("span");
    span.className = "error-span";
    span.dataset.label = `v${match[1]}`;
    span.textContent = match[2];
    container.append(span);
    cursor = match.index + match[0].length;
    match = pattern.exec(text);
  }

  if (cursor < text.length) {
    container.append(document.createTextNode(text.slice(cursor)));
  }

  if (!text) {
    appendEmpty(container, "No annotated translation");
  }
}

function addResponseSection(container, title) {
  const section = document.createElement("section");
  section.className = "response-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  container.append(section);
  return section;
}

function setEmptyResponse(container, text) {
  container.replaceChildren();
  appendEmpty(container, text);
}

function appendEmpty(container, text) {
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = text;
  container.append(empty);
}

function redactScores(text) {
  return text
    .replace(/(Score:\s*)[-+]?\d+(?:\.\d+)?(?:\s*\(0-100\))?/gi, "$1[hidden]")
    .replace(/(final score(?: is|:)?\s*)[-+]?\d+(?:\.\d+)?/gi, "$1[hidden]")
    .replace(/(Overall score:\s*)[-+]?\d+(?:\.\d+)?/gi, "$1[hidden]");
}

function renderDecision() {
  const item = getCurrentCase();
  const annotation = item ? state.annotations[item.id] : null;
  const preference = annotation?.preference_side || "";
  const tags = new Set(annotation?.reason_tags || []);

  els.preferenceButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.preference === preference);
  });

  els.reasonInputs.forEach((input) => {
    input.checked = tags.has(input.value);
  });

  els.confidenceInput.value = annotation?.confidence || 3;
  els.notesInput.value = annotation?.notes || "";
  els.prevBtn.disabled = state.currentIndex <= 0;
  els.nextBtn.disabled = state.currentIndex >= state.orderedCases.length - 1;
}

function renderProgress() {
  const total = state.allCases.length;
  const annotations = Object.values(state.annotations);
  const completed = annotations.filter((item) => item.preference_side).length;
  const aWins = annotations.filter((item) => item.preference_side === "A").length;
  const bWins = annotations.filter((item) => item.preference_side === "B").length;
  const ties = annotations.filter((item) => item.preference_side === "tie").length;

  els.progressText.textContent = `${completed} / ${total}`;
  els.aWinsText.textContent = String(aWins);
  els.bWinsText.textContent = String(bWins);
  els.tiesText.textContent = String(ties);
}

function setPreference(preference) {
  const item = getCurrentCase();
  if (!item) return;
  const mapping = getMapping(item);
  const preferredModel = preference === "A" || preference === "B" ? mapping[preference] : "";

  updateCurrentAnnotation({
    preference_side: preference,
    preferred_model: preferredModel,
    response_a_model: mapping.A,
    response_b_model: mapping.B
  });
  renderDecision();
  renderProgress();
}

function updateCurrentAnnotation(patch) {
  const item = getCurrentCase();
  if (!item) return;
  const mapping = getMapping(item);
  const existing = state.annotations[item.id] || {};
  const annotation = {
    case_id: item.id,
    dataset_id: item.dataset_id,
    seg_id: item.seg_id,
    participant_id: getParticipantKey(),
    response_a_model: mapping.A,
    response_b_model: mapping.B,
    confidence: 3,
    notes: "",
    reason_tags: [],
    ...existing,
    ...patch,
    updated_at: new Date().toISOString()
  };

  state.annotations[item.id] = annotation;
  saveAnnotations();
}

function getSelectedReasonTags() {
  return els.reasonInputs.filter((input) => input.checked).map((input) => input.value);
}

function moveCase(delta) {
  if (!state.orderedCases.length) return;
  state.currentIndex = Math.max(0, Math.min(state.orderedCases.length - 1, state.currentIndex + delta));
  render();
}

function handleKeyboard(event) {
  const tagName = event.target?.tagName?.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") return;

  if (event.key === "ArrowLeft") moveCase(-1);
  if (event.key === "ArrowRight") moveCase(1);
  if (event.key === "1") setPreference("A");
  if (event.key === "2") setPreference("tie");
  if (event.key === "3") setPreference("B");
  if (event.key === "4") setPreference("both_bad");
}

function exportCsv() {
  const rows = buildExportRows();
  const headers = getExportHeaders();
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  ].join("\r\n");

  downloadText(csv, exportName("csv"), "text/csv;charset=utf-8");
}

function exportJson() {
  const payload = {
    study: "MT Evaluation Rationale Preference",
    exported_at: new Date().toISOString(),
    dataset_id: state.datasetId,
    dataset_label: getDataset().label,
    participant_id: getParticipantKey(),
    rows: buildExportRows()
  };
  downloadText(JSON.stringify(payload, null, 2), exportName("json"), "application/json;charset=utf-8");
}

function buildExportRows() {
  return state.allCases
    .map((item) => {
      const annotation = state.annotations[item.id];
      if (!annotation) return null;
      const mapping = getMapping(item);
      const preferredModel =
        annotation.preference_side === "A" || annotation.preference_side === "B"
          ? mapping[annotation.preference_side]
          : "";

      return {
        participant_id: annotation.participant_id || getParticipantKey(),
        dataset_id: item.dataset_id,
        case_id: item.id,
        original_index: item.original_index,
        seg_id: item.seg_id,
        lp: item.lp,
        system: item.system,
        source: item.source,
        translation: item.translation,
        reference: item.reference,
        response_a_model: mapping.A,
        response_b_model: mapping.B,
        preference_side: annotation.preference_side || "",
        preferred_model: preferredModel,
        preferred_model_label: preferredModel ? MODEL_LABELS[preferredModel] : "",
        reason_tags: (annotation.reason_tags || []).join("|"),
        confidence: annotation.confidence || "",
        notes: annotation.notes || "",
        updated_at: annotation.updated_at || ""
      };
    })
    .filter(Boolean);
}

function getExportHeaders() {
  return [
    "participant_id",
    "dataset_id",
    "case_id",
    "original_index",
    "seg_id",
    "lp",
    "system",
    "source",
    "translation",
    "reference",
    "response_a_model",
    "response_b_model",
    "preference_side",
    "preferred_model",
    "preferred_model_label",
    "reason_tags",
    "confidence",
    "notes",
    "updated_at"
  ];
}

function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadText(text, fileName, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportName(extension) {
  const participant = getParticipantKey().replace(/[^a-z0-9_-]+/gi, "_");
  const stamp = new Date().toISOString().slice(0, 10);
  return `${state.datasetId}_${participant}_${stamp}.${extension}`;
}

function resetCurrentAnnotations() {
  const ok = window.confirm("Clear saved judgments for this dataset and participant?");
  if (!ok) return;
  state.annotations = {};
  localStorage.removeItem(annotationStorageKey());
  render();
}

function getCurrentCase() {
  return state.orderedCases[state.currentIndex] || null;
}

function isComplete(caseId) {
  return Boolean(state.annotations[caseId]?.preference_side);
}

function getDataset() {
  return DATASETS.find((dataset) => dataset.id === state.datasetId) || DATASETS[0];
}

function getParticipantKey() {
  const value = els.participantInput?.value?.trim();
  return value || getSessionId();
}

function getSessionId() {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;

  const value = crypto.randomUUID ? crypto.randomUUID() : `anon-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(SESSION_KEY, value);
  return value;
}

function annotationStorageKey() {
  return `${STORAGE_PREFIX}:${state.datasetId}:${getParticipantKey()}`;
}

function loadAnnotations() {
  try {
    return JSON.parse(localStorage.getItem(annotationStorageKey()) || "{}");
  } catch (error) {
    return {};
  }
}

function saveAnnotations() {
  localStorage.setItem(annotationStorageKey(), JSON.stringify(state.annotations));
}

function loadMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function saveMeta() {
  const meta = {
    datasetId: els.datasetSelect.value,
    participantId: els.participantInput.value.trim(),
    order: els.orderSelect.value,
    hideScores: els.hideScoresInput.checked
  };
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}
