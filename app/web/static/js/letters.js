let currentLettersRoomCode = localStorage.getItem("letters_room_code") || null;
let currentLettersPlayerId = localStorage.getItem("letters_player_id") || null;
let currentLettersPlayerName = localStorage.getItem("letters_player_name") || null;

let currentLettersRoomData = null;
let lettersIsHost = false;

let selectedLettersPlayerCount = 4;
let selectedLettersRounds = 5;
let selectedLettersTimer = 60;
let selectedLettersMinDone = 10;
let selectedLettersNoTimer = false;
let selectedLettersPresetCategoryIds = [];
let selectedLettersCustomCategories = [];
let selectedLettersCharacter = localStorage.getItem("letters_character_id") || "char1";
let lettersPresetCategories = [];

let lettersWS = null;
let lettersWSRoomCode = null;
let lettersWSShouldReconnect = false;
let lettersWSReconnectTimer = null;
let lettersActionCounter = 0;
const pendingLettersActions = new Map();
let lettersAutosaveTimer = null;

const lettersPlayerCountOptions = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const lettersTimerOptions = [30, 45, 60, 90];
const lettersMinDoneOptions = [0, 5, 10, 15, 20];
const lettersCharacterOptions = Array.from({ length: 12 }, (_, i) => `char${i + 1}`);

document.addEventListener("DOMContentLoaded", async () => {
    renderLettersCharacterButtons();
    renderLettersPlayerCountButtons();
    renderLettersRoundButtons();
    renderLettersTimerButtons();
    renderLettersMinDoneButtons();
    await loadLettersCategories();

    const noTimerToggle = lettersEl("lettersNoTimerToggle");
    if (noTimerToggle) noTimerToggle.checked = selectedLettersNoTimer;

    const defaultLobbyName = typeof getDefaultLobbyName === "function" ? getDefaultLobbyName() : "";
    const nameInput = lettersEl("lettersName");
    if (nameInput && defaultLobbyName) nameInput.placeholder = defaultLobbyName;
    if (nameInput && !nameInput.value.trim()) nameInput.value = currentLettersPlayerName || defaultLobbyName;

    const roomInput = lettersEl("lettersRoomInput");
    if (roomInput && currentLettersRoomCode) roomInput.value = currentLettersRoomCode;

    if (currentLettersRoomCode && currentLettersPlayerId) {
        await refreshLettersRoomState();
    } else {
        await maybeAutoJoinLettersInvite();
    }
});

function lettersEl(id) {
    return document.getElementById(id);
}

function showLettersError(message) {
    const box = lettersEl("letters-global-error");
    if (!box) return;
    box.textContent = message;
    box.classList.remove("hidden");
}

function hideLettersError() {
    const box = lettersEl("letters-global-error");
    if (!box) return;
    box.classList.add("hidden");
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function buildLettersPlayerIdentity(player) {
    return `
        <div class="letters-player-identity">
            <img src="/static/images/${player.character_id || "char1"}.png" class="letters-player-avatar" alt="${escapeHtml(player.name)}">
            <div class="letters-player-text">
                <span class="letters-player-name">${escapeHtml(player.name)}</span>
            </div>
        </div>
    `;
}

async function maybeAutoJoinLettersInvite() {
    if (!window.appCurrentUser || currentLettersRoomCode || currentLettersPlayerId) return;
    const params = new URLSearchParams(window.location.search);
    const inviteRoom = params.get("invite_room");
    const accepted = params.get("invite_accept");
    if (!inviteRoom || accepted !== "1") return;

    const preferredName = (window.appCurrentUser.display_name || window.appCurrentUser.username || "").trim();
    if (preferredName) {
        currentLettersPlayerName = preferredName;
        localStorage.setItem("letters_player_name", preferredName);
        const nameInput = lettersEl("lettersName");
        if (nameInput) nameInput.value = preferredName;
    }

    const roomInput = lettersEl("lettersRoomInput");
    if (roomInput) roomInput.value = inviteRoom;
    history.replaceState({}, "", location.pathname);
    await joinLettersRoom();
}

function nextLettersActionId() {
    lettersActionCounter += 1;
    return `letters-action-${Date.now()}-${lettersActionCounter}`;
}

function clearLettersWSReconnectTimer() {
    if (!lettersWSReconnectTimer) return;
    clearTimeout(lettersWSReconnectTimer);
    lettersWSReconnectTimer = null;
}

function closeLettersWS({ shouldReconnect = false } = {}) {
    lettersWSShouldReconnect = shouldReconnect;
    clearLettersWSReconnectTimer();
    if (!lettersWS) {
        lettersWSRoomCode = null;
        return;
    }
    const socket = lettersWS;
    lettersWS = null;
    lettersWSRoomCode = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        try {
            socket.close();
        } catch (error) {
            console.error("Letters WS close error:", error);
        }
    }
}

function scheduleLettersWSReconnect(roomCode) {
    if (!lettersWSShouldReconnect || !roomCode || !currentLettersPlayerId || lettersWSReconnectTimer) return;
    lettersWSReconnectTimer = setTimeout(() => {
        lettersWSReconnectTimer = null;
        if (!lettersWSShouldReconnect || currentLettersRoomCode !== roomCode || !currentLettersPlayerId) return;
        connectLettersWS(roomCode);
    }, 1500);
}

function connectLettersWS(roomCode) {
    if (!roomCode || !currentLettersPlayerId) return;
    if (lettersWS && lettersWSRoomCode === roomCode && (lettersWS.readyState === WebSocket.OPEN || lettersWS.readyState === WebSocket.CONNECTING)) {
        return;
    }
    closeLettersWS({ shouldReconnect: true });
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://${window.location.host}/api/letters/ws/${roomCode}?player_id=${encodeURIComponent(currentLettersPlayerId)}`;
    lettersWSRoomCode = roomCode;
    lettersWSShouldReconnect = true;
    lettersWS = new WebSocket(wsUrl);

    lettersWS.onopen = () => {
        sendLettersWSAction("sync_request", {}).catch(() => {});
    };
    lettersWS.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === "state_sync" && data.state) {
                applyLettersStateSync(data.state);
                return;
            }
            if (data.type === "action_ack" && data.action_id) {
                const pending = pendingLettersActions.get(data.action_id);
                if (pending) {
                    pendingLettersActions.delete(data.action_id);
                    pending.resolve();
                }
                return;
            }
            if (data.type === "action_error" && data.action_id) {
                const pending = pendingLettersActions.get(data.action_id);
                if (pending) {
                    pendingLettersActions.delete(data.action_id);
                    pending.reject(new Error(data.detail || "Action failed."));
                }
                if (data.detail) showLettersError(data.detail);
            }
        } catch (error) {
            console.error("Letters WS parse error:", error);
        }
    };
    lettersWS.onerror = (error) => console.error("Letters WS error:", error);
    lettersWS.onclose = () => scheduleLettersWSReconnect(roomCode);
}

function sendLettersWSAction(type, extra = {}) {
    if (!lettersWS || lettersWS.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("Realtime connection is not ready."));
    }
    const actionId = nextLettersActionId();
    const payload = { type, action_id: actionId, player_id: currentLettersPlayerId, ...extra };
    return new Promise((resolve, reject) => {
        pendingLettersActions.set(actionId, { resolve, reject });
        lettersWS.send(JSON.stringify(payload));
        setTimeout(() => {
            const pending = pendingLettersActions.get(actionId);
            if (pending) {
                pendingLettersActions.delete(actionId);
                pending.reject(new Error("Action timed out."));
            }
        }, 8000);
    });
}

async function postLettersJson(path, payload) {
    const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(typeof data?.detail === "string" ? data.detail : "Request failed.");
    }
    return data;
}

async function executeLettersAction({ wsType, wsPayload = {}, restPath = null, restPayload = null }) {
    if (lettersWS && lettersWS.readyState === WebSocket.OPEN) {
        await sendLettersWSAction(wsType, wsPayload);
        return null;
    }
    if (!restPath) {
        throw new Error("Realtime connection is not ready.");
    }
    return postLettersJson(restPath, restPayload);
}

function applyLettersStateSync(data) {
    const hadRoomState = !!currentLettersRoomData;
    currentLettersRoomData = data;
    lettersIsHost = data.host_id === currentLettersPlayerId;
    hideLettersError();
    const setupVisible = !lettersEl("screen-letters-setup")?.classList.contains("hidden");
    if (setupVisible && hadRoomState && !data.started && data.phase === "waiting") return;
    renderLettersScreen(data);
}

async function loadLettersCategories() {
    const response = await fetch("/api/letters/categories");
    const data = await response.json().catch(() => ({}));
    lettersPresetCategories = data.categories || [];
    renderLettersPresetButtons();
}

function renderSelectableButtons(containerId, values, selectedValue, formatter, onSelect) {
    const grid = lettersEl(containerId);
    if (!grid) return;
    grid.innerHTML = "";
    values.forEach((value) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `category-btn ${selectedValue === value ? "active" : ""}`;
        button.textContent = formatter(value);
        button.onclick = () => onSelect(value);
        grid.appendChild(button);
    });
}

function renderLettersPlayerCountButtons() {
    const grid = lettersEl("lettersPlayerCountGrid");
    if (!grid) return;
    grid.innerHTML = "";
    lettersPlayerCountOptions.forEach((count) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `category-btn ${selectedLettersPlayerCount === count ? "active" : ""}`;
        button.textContent = `${count} لاعبين`;
        button.onclick = () => {
            selectedLettersPlayerCount = count;
            if (selectedLettersRounds && selectedLettersRounds < count) selectedLettersRounds = count;
            renderLettersPlayerCountButtons();
            renderLettersRoundButtons();
        };
        grid.appendChild(button);
    });
}

function renderLettersRoundButtons() {
    const grid = lettersEl("lettersRoundsGrid");
    if (!grid) return;
    grid.innerHTML = "";
    let options = [];
    if (selectedLettersPlayerCount) {
        for (let rounds = selectedLettersPlayerCount; rounds <= 10; rounds += selectedLettersPlayerCount) options.push(rounds);
    } else {
        options = [2, 3, 4, 5, 6, 7, 8, 9, 10];
    }
    if (!selectedLettersRounds || !options.includes(selectedLettersRounds)) {
        selectedLettersRounds = options[0] || null;
    }
    options.forEach((rounds) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `category-btn ${selectedLettersRounds === rounds ? "active" : ""}`;
        button.textContent = `${rounds} جولات`;
        button.onclick = () => {
            selectedLettersRounds = rounds;
            renderLettersRoundButtons();
        };
        grid.appendChild(button);
    });
}

function renderLettersTimerButtons() {
    renderSelectableButtons("lettersTimerGrid", lettersTimerOptions, selectedLettersTimer, (v) => `${v} ثانية`, (v) => {
        selectedLettersTimer = v;
        renderLettersTimerButtons();
    });
}

function renderLettersMinDoneButtons() {
    renderSelectableButtons("lettersDoneGrid", lettersMinDoneOptions, selectedLettersMinDone, (v) => (v === 0 ? "فوري" : `${v} ثانية`), (v) => {
        selectedLettersMinDone = v;
        renderLettersMinDoneButtons();
    });
}

function renderLettersCharacterButtons() {
    const preview = lettersEl("lettersCharacterPreview");
    const grid = lettersEl("lettersCharacterGrid");
    if (!preview || !grid) return;
    preview.src = `/static/images/${selectedLettersCharacter}.png`;
    grid.innerHTML = "";
    lettersCharacterOptions.forEach((characterId) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `character-btn ${selectedLettersCharacter === characterId ? "active" : ""}`;
        button.innerHTML = `<img src="/static/images/${characterId}.png" class="character-btn-img" alt="${characterId}">`;
        button.onclick = () => {
            selectedLettersCharacter = characterId;
            localStorage.setItem("letters_character_id", characterId);
            renderLettersCharacterButtons();
        };
        grid.appendChild(button);
    });
}

function renderLettersWaitCharacterPicker(data) {
    const preview = lettersEl("lettersWaitCharacterPreview");
    const grid = lettersEl("lettersWaitCharacterGrid");
    if (!preview || !grid) return;
    const me = (data.players || []).find((player) => player.id === currentLettersPlayerId);
    const activeCharacterId = me?.character_id || selectedLettersCharacter;
    preview.src = `/static/images/${activeCharacterId}.png`;
    grid.innerHTML = "";
    lettersCharacterOptions.forEach((characterId) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `character-btn ${characterId === activeCharacterId ? "active" : ""}`;
        button.innerHTML = `<img src="/static/images/${characterId}.png" class="character-btn-img" alt="${characterId}">`;
        button.onclick = () => updateLettersLobbyCharacter(characterId);
        grid.appendChild(button);
    });
}

async function updateLettersLobbyCharacter(characterId) {
    if (!currentLettersRoomCode || !currentLettersPlayerId) return;
    try {
        const data = await executeLettersAction({
            wsType: "update_character",
            wsPayload: { character_id: characterId },
            restPath: `/api/letters/rooms/${currentLettersRoomCode}/character`,
            restPayload: { player_id: currentLettersPlayerId, character_id: characterId },
        });
        selectedLettersCharacter = characterId;
        localStorage.setItem("letters_character_id", selectedLettersCharacter);
        if (data) applyLettersStateSync(data);
    } catch (error) {
        showLettersError(error.message || "تعذر تحديث الشخصية.");
    }
}

function hideAllLettersScreens() {
    [
        "screen-letters-lobby",
        "screen-letters-setup",
        "screen-letters-wait",
        "screen-letters-choose",
        "screen-letters-answer",
        "screen-letters-reveal",
        "screen-letters-voting",
        "screen-letters-result",
        "screen-letters-finished",
    ].forEach((id) => lettersEl(id)?.classList.add("hidden"));
}

function showLettersSetup() {
    hideLettersError();
    const editing = !!(currentLettersRoomCode && currentLettersRoomData && !currentLettersRoomData.started);
    const button = lettersEl("lettersSetupConfirmButton");
    if (button) {
        button.textContent = editing ? "حفظ الإعدادات" : "تأكيد الإعدادات";
        button.onclick = editing ? saveLettersRoomSettings : createLettersRoom;
    }
    hideAllLettersScreens();
    lettersEl("screen-letters-setup")?.classList.remove("hidden");
}

function goBackToLettersLobby() {
    hideLettersError();
    if (currentLettersRoomData && !currentLettersRoomData.started) {
        renderLettersWaitingRoom(currentLettersRoomData);
        return;
    }
    hideAllLettersScreens();
    lettersEl("screen-letters-lobby")?.classList.remove("hidden");
}

function buildLettersSettingsPayload() {
    return {
        max_player_count: selectedLettersPlayerCount,
        total_rounds: selectedLettersRounds,
        answer_timer_seconds: selectedLettersTimer,
        no_timer: Boolean(lettersEl("lettersNoTimerToggle")?.checked),
        min_done_seconds: selectedLettersMinDone,
        preset_category_ids: currentLettersRoomData?.preset_category_ids || [],
        custom_categories: currentLettersRoomData?.custom_categories || [],
    };
}

async function createLettersRoom() {
    const name = String(lettersEl("lettersName")?.value || "").trim();
    if (!name) return showLettersError("اكتب اسم اللاعب أولًا.");
    hideLettersError();
    try {
        const data = await postLettersJson("/api/letters/rooms", {
            host_name: name,
            character_id: selectedLettersCharacter,
            max_player_count: selectedLettersPlayerCount,
            total_rounds: selectedLettersRounds,
            answer_timer_seconds: selectedLettersTimer,
            no_timer: Boolean(lettersEl("lettersNoTimerToggle")?.checked),
            min_done_seconds: selectedLettersMinDone,
            preset_category_ids: [],
            custom_categories: [],
        });
        currentLettersRoomCode = data.room_code;
        currentLettersPlayerId = data.host_id;
        currentLettersPlayerName = name;
        localStorage.setItem("letters_room_code", currentLettersRoomCode);
        localStorage.setItem("letters_player_id", currentLettersPlayerId);
        localStorage.setItem("letters_player_name", currentLettersPlayerName);
        connectLettersWS(currentLettersRoomCode);
        applyLettersStateSync(data);
    } catch (error) {
        showLettersError(error.message || "تعذر إنشاء الغرفة.");
    }
}

function openLettersSettingsEditorFromRoom() {
    if (!currentLettersRoomData) return;
    selectedLettersPlayerCount = currentLettersRoomData.max_player_count;
    selectedLettersRounds = currentLettersRoomData.total_rounds;
    selectedLettersTimer = currentLettersRoomData.answer_timer_seconds;
    selectedLettersMinDone = currentLettersRoomData.min_done_seconds;
    selectedLettersNoTimer = currentLettersRoomData.no_timer;
    const noTimerToggle = lettersEl("lettersNoTimerToggle");
    if (noTimerToggle) noTimerToggle.checked = selectedLettersNoTimer;
    renderLettersPlayerCountButtons();
    renderLettersRoundButtons();
    renderLettersTimerButtons();
    renderLettersMinDoneButtons();
    showLettersSetup();
}

async function saveLettersRoomSettings() {
    if (!currentLettersRoomCode || !currentLettersPlayerId) return;
    hideLettersError();
    try {
        const payload = buildLettersSettingsPayload();
        const data = await executeLettersAction({
            wsType: "update_settings",
            wsPayload: payload,
            restPath: `/api/letters/rooms/${currentLettersRoomCode}/settings`,
            restPayload: { host_id: currentLettersPlayerId, ...payload },
        });
        if (data) applyLettersStateSync(data);
        if (currentLettersRoomData) renderLettersWaitingRoom(currentLettersRoomData);
    } catch (error) {
        showLettersError(error.message || "تعذر حفظ الإعدادات.");
    }
}

async function joinLettersRoom() {
    const roomCode = String(lettersEl("lettersRoomInput")?.value || "").trim().toUpperCase();
    const fallbackName = typeof getDefaultLobbyName === "function" ? getDefaultLobbyName() : "";
    const name = String(lettersEl("lettersName")?.value || "").trim() || fallbackName;
    if (!roomCode || !name) return showLettersError("أدخل الاسم وكود الغرفة.");
    hideLettersError();
    try {
        const data = await postLettersJson(`/api/letters/rooms/${roomCode}/join`, {
            player_name: name,
            character_id: selectedLettersCharacter,
        });
        const me = (data.players || []).find((player) => player.name === name);
        if (!me) throw new Error("تعذر تحديد اللاعب داخل الغرفة.");
        currentLettersRoomCode = data.room_code;
        currentLettersPlayerId = me.id;
        currentLettersPlayerName = name;
        localStorage.setItem("letters_room_code", currentLettersRoomCode);
        localStorage.setItem("letters_player_id", currentLettersPlayerId);
        localStorage.setItem("letters_player_name", currentLettersPlayerName);
        connectLettersWS(currentLettersRoomCode);
        await refreshLettersRoomState();
    } catch (error) {
        showLettersError(error.message || "تعذر الانضمام إلى الغرفة.");
    }
}

async function refreshLettersRoomState() {
    if (!currentLettersRoomCode) return;
    try {
        const query = currentLettersPlayerId ? `?player_id=${encodeURIComponent(currentLettersPlayerId)}` : "";
        const response = await fetch(`/api/letters/rooms/${currentLettersRoomCode}${query}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 404) return resetLettersAndExit();
            throw new Error(typeof data?.detail === "string" ? data.detail : "تعذر تحديث الغرفة.");
        }
        applyLettersStateSync(data);
        if (currentLettersRoomCode && currentLettersPlayerId) connectLettersWS(currentLettersRoomCode);
    } catch (error) {
        showLettersError(error.message || "تعذر تحديث الغرفة.");
    }
}

async function syncLettersWaitingCategories(presetCategoryIds, customCategories) {
    if (!currentLettersRoomCode || !currentLettersPlayerId || !currentLettersRoomData || !lettersIsHost || currentLettersRoomData.started) {
        return;
    }
    const payload = {
        max_player_count: currentLettersRoomData.max_player_count,
        total_rounds: currentLettersRoomData.total_rounds,
        answer_timer_seconds: currentLettersRoomData.answer_timer_seconds,
        no_timer: currentLettersRoomData.no_timer,
        min_done_seconds: currentLettersRoomData.min_done_seconds,
        preset_category_ids: presetCategoryIds,
        custom_categories: customCategories,
    };
    const data = await executeLettersAction({
        wsType: "update_settings",
        wsPayload: payload,
        restPath: `/api/letters/rooms/${currentLettersRoomCode}/settings`,
        restPayload: { host_id: currentLettersPlayerId, ...payload },
    });
    if (data) applyLettersStateSync(data);
}

function renderLettersPresetButtons() {
    const grid = lettersEl("lettersPresetGrid");
    if (!grid) return;
    const canEdit = lettersIsHost && currentLettersRoomData && !currentLettersRoomData.started;
    grid.innerHTML = "";
    lettersPresetCategories.forEach((category) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `category-btn ${selectedLettersPresetCategoryIds.includes(category.id) ? "active" : ""}`;
        button.textContent = category.label;
        button.disabled = !canEdit;
        if (!canEdit) button.classList.add("disabled");
        button.onclick = async () => {
            if (!canEdit) return;
            if (selectedLettersPresetCategoryIds.includes(category.id)) {
                selectedLettersPresetCategoryIds = selectedLettersPresetCategoryIds.filter((id) => id !== category.id);
            } else {
                selectedLettersPresetCategoryIds = [...selectedLettersPresetCategoryIds, category.id];
            }
            renderLettersPresetButtons();
            try {
                await syncLettersWaitingCategories(selectedLettersPresetCategoryIds, selectedLettersCustomCategories);
            } catch (error) {
                showLettersError(error.message || "تعذر تحديث التصنيفات.");
            }
        };
        grid.appendChild(button);
    });
}

function renderLettersCustomCategories() {
    const list = lettersEl("lettersCustomCategoryList");
    if (!list) return;
    const canEdit = lettersIsHost && currentLettersRoomData && !currentLettersRoomData.started;
    list.innerHTML = "";
    selectedLettersCustomCategories.forEach((label, index) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "letters-chip";
        chip.disabled = !canEdit;
        chip.textContent = canEdit ? `${label} ×` : label;
        chip.onclick = async () => {
            if (!canEdit) return;
            selectedLettersCustomCategories = selectedLettersCustomCategories.filter((_, itemIndex) => itemIndex !== index);
            renderLettersCustomCategories();
            try {
                await syncLettersWaitingCategories(selectedLettersPresetCategoryIds, selectedLettersCustomCategories);
            } catch (error) {
                showLettersError(error.message || "تعذر تحديث التصنيفات.");
            }
        };
        list.appendChild(chip);
    });
}

async function addLettersCustomCategory() {
    const canEdit = lettersIsHost && currentLettersRoomData && !currentLettersRoomData.started;
    if (!canEdit) return;
    const input = lettersEl("lettersCustomCategoryInput");
    const value = String(input?.value || "").trim().replace(/\s+/g, " ");
    if (!value) return;
    const normalized = value.toLowerCase();
    const presetLabels = new Set(lettersPresetCategories.map((item) => String(item.label || "").toLowerCase()));
    const customLabels = new Set(selectedLettersCustomCategories.map((item) => String(item).toLowerCase()));
    if (presetLabels.has(normalized) || customLabels.has(normalized)) {
        return showLettersError("هذا التصنيف موجود مسبقًا.");
    }
    selectedLettersCustomCategories = [...selectedLettersCustomCategories, value];
    if (input) input.value = "";
    hideLettersError();
    renderLettersCustomCategories();
    try {
        await syncLettersWaitingCategories(selectedLettersPresetCategoryIds, selectedLettersCustomCategories);
    } catch (error) {
        showLettersError(error.message || "تعذر تحديث التصنيفات.");
    }
}

function renderLettersScreen(data) {
    if (!data.started) return renderLettersWaitingRoom(data);
    if (data.phase === "choosing_letter") return renderLettersChoose(data);
    if (data.phase === "answering") return renderLettersAnswer(data);
    if (data.phase === "reveal") return renderLettersReveal(data);
    if (data.phase === "voting") return renderLettersVoting(data);
    if (data.phase === "round_result") return renderLettersResult(data);
    return renderLettersFinished(data);
}

function buildLettersPlayerActionCell(player) {
    if (lettersIsHost && player.id !== currentLettersPlayerId && !currentLettersRoomData?.started) {
        return `<td><button class="btn btn-danger" onclick="removeLettersPlayer('${player.id}')">حذف</button></td>`;
    }
    return "<td></td>";
}

function renderLettersWaitingRoom(data) {
    hideAllLettersScreens();
    lettersEl("screen-letters-wait")?.classList.remove("hidden");
    lettersEl("lettersDisplayCode").textContent = data.room_code;
    renderLettersWaitCharacterPicker(data);
    const tbody = lettersEl("lettersPlayerList");
    if (tbody) {
        tbody.innerHTML = "";
        [...(data.players || [])].sort((a, b) => b.score - a.score).forEach((player) => {
            const row = document.createElement("tr");
            row.innerHTML = `<td>${buildLettersPlayerIdentity(player)}</td><td>${player.score}</td>${buildLettersPlayerActionCell(player)}`;
            tbody.appendChild(row);
        });
    }
    lettersEl("lettersSettingsSummary").innerHTML = `
        <div class="letters-settings-card">
            <div><strong>الجولات:</strong> ${data.total_rounds}</div>
            <div><strong>المؤقت:</strong> ${data.no_timer ? "بدون مؤقت" : `${data.answer_timer_seconds} ثانية`}</div>
            <div><strong>الانتهاء المبكر:</strong> ${data.min_done_seconds === 0 ? "فوري" : `${data.min_done_seconds} ثانية`}</div>
            <div><strong>التصنيفات المختارة:</strong> ${data.active_categories?.length ? data.active_categories.join(" - ") : "لم يتم اختيار أي تصنيف بعد"}</div>
        </div>`;

    selectedLettersPresetCategoryIds = [...(data.preset_category_ids || [])];
    selectedLettersCustomCategories = [...(data.custom_categories || [])];
    renderLettersPresetButtons();
    renderLettersCustomCategories();

    const canEdit = lettersIsHost && !data.started;
    const customInput = lettersEl("lettersCustomCategoryInput");
    const addButton = customInput?.parentElement?.querySelector("button");
    if (customInput) customInput.disabled = !canEdit;
    if (addButton) addButton.disabled = !canEdit;
    const info = lettersEl("lettersCategorySelectionInfo");
    if (info) info.textContent = lettersIsHost ? `تم اختيار ${data.active_categories?.length || 0} تصنيفات` : ((data.active_categories?.length || 0) ? `المنظّم يختار التصنيفات الآن: ${data.active_categories.length}` : "المنظّم لم يختر أي تصنيف بعد");

    if (window.appCurrentUser && lettersIsHost && currentLettersRoomCode) {
        const hostArea = lettersEl("lettersHostArea");
        if (hostArea && !hostArea.querySelector(".invite-friends-btn")) {
            const inviteButton = document.createElement("button");
            inviteButton.type = "button";
            inviteButton.className = "btn invite-friends-btn";
            inviteButton.textContent = "دعوة الأصدقاء";
            inviteButton.onclick = () => openInviteFriendsModal("letters", currentLettersRoomCode);
            hostArea.insertBefore(inviteButton, hostArea.firstChild);
        }
    }

    lettersEl("lettersHostArea")?.classList.toggle("hidden", !lettersIsHost);
    lettersEl("lettersMemberArea")?.classList.toggle("hidden", lettersIsHost);
}

function renderLettersUsedLetters(data, containerId) {
    const container = lettersEl(containerId);
    if (!container) return;
    container.innerHTML = "";
    (data.allowed_letters || []).forEach((letter) => {
        const chip = document.createElement("div");
        chip.className = `letters-used-chip ${(data.used_letters || []).includes(letter) ? "used" : ""} ${data.current_letter === letter ? "active" : ""}`;
        chip.textContent = letter;
        container.appendChild(chip);
    });
}

function renderLettersChoose(data) {
    hideAllLettersScreens();
    lettersEl("screen-letters-choose")?.classList.remove("hidden");
    lettersEl("lettersRoundInfoChoose").textContent = `الجولة ${data.current_round} / ${data.total_rounds}`;
    const chooser = (data.players || []).find((player) => player.id === data.current_chooser_id);
    const isChooser = data.current_chooser_id === currentLettersPlayerId;
    lettersEl("lettersChooserInfo").textContent = isChooser
        ? "اختر حرفًا غير مستخدم لبدء الجولة."
        : `${chooser ? chooser.name : "اللاعب"} يختار الحرف الآن.`;
    renderLettersUsedLetters(data, "lettersUsedLettersChoose");
    const grid = lettersEl("lettersLetterGrid");
    if (!grid) return;
    grid.innerHTML = "";
    (data.allowed_letters || []).forEach((letter) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "letters-letter-btn";
        button.textContent = letter;
        const used = (data.used_letters || []).includes(letter);
        button.disabled = used || !isChooser;
        if (used) button.classList.add("used");
        button.onclick = () => chooseLettersLetter(letter);
        grid.appendChild(button);
    });
    lettersEl("lettersHostNextChoose")?.classList.toggle("hidden", !lettersIsHost);
}

function renderLettersAnswer(data) {
    hideAllLettersScreens();
    lettersEl("screen-letters-answer")?.classList.remove("hidden");
    lettersEl("lettersRoundInfoAnswer").textContent = `الجولة ${data.current_round} / ${data.total_rounds}`;
    lettersEl("lettersTimerAnswer").textContent = buildLettersTimerText(data);
    lettersEl("lettersAnswerPhaseInfo").textContent = data.no_timer ? `الحرف الحالي: ${data.current_letter} - بدون مؤقت` : `الحرف الحالي: ${data.current_letter}`;
    lettersEl("lettersAnswerLetterBadge").textContent = data.current_letter || "-";
    renderLettersUsedLetters(data, "lettersUsedLettersAnswer");

    const answers = data.submissions?.[currentLettersPlayerId] || [];
    const focusedElement = document.activeElement;
    let focusedInputState = null;
    if (focusedElement && focusedElement.matches?.("#lettersAnswerGrid input")) {
        focusedInputState = {
            index: Number(focusedElement.dataset.categoryIndex),
            value: focusedElement.value || "",
            start: focusedElement.selectionStart ?? 0,
            end: focusedElement.selectionEnd ?? 0,
        };
    }
    const grid = lettersEl("lettersAnswerGrid");
    if (grid) {
        grid.innerHTML = "";
        (data.active_categories || []).forEach((category, index) => {
            const card = document.createElement("label");
            card.className = "letters-answer-card";
            card.innerHTML = `<span class="letters-answer-label">${escapeHtml(category)}</span><input type="text" data-category-index="${index}" value="${escapeHtml(answers[index] || "")}" placeholder="اكتب الإجابة">`;
            const input = card.querySelector("input");
            input.addEventListener("input", scheduleLettersAutosave);
            grid.appendChild(card);
        });

        if (focusedInputState && Number.isFinite(focusedInputState.index)) {
            const targetInput = grid.querySelector(`input[data-category-index="${focusedInputState.index}"]`);
            if (targetInput) {
                if (targetInput.value !== focusedInputState.value) {
                    targetInput.value = focusedInputState.value;
                }
                targetInput.focus({ preventScroll: true });
                const maxLen = targetInput.value.length;
                const start = Math.min(focusedInputState.start, maxLen);
                const end = Math.min(focusedInputState.end, maxLen);
                targetInput.setSelectionRange(start, end);
            }
        }
    }
    updateLettersDoneAvailability(data);
    renderLettersScoreboard("lettersScoreboardAnswer", data.players || []);
    lettersEl("lettersHostNextAnswer")?.classList.toggle("hidden", !lettersIsHost);
}

function renderLettersReveal(data) {
    hideAllLettersScreens();
    lettersEl("screen-letters-reveal")?.classList.remove("hidden");
    lettersEl("lettersRoundInfoReveal").textContent = `الجولة ${data.current_round} / ${data.total_rounds}`;
    lettersEl("lettersRevealInfo").textContent = `انتهى الإدخال. هذه الإجابات على حرف ${data.last_round_letter || data.current_letter || "-"}.`;
    lettersEl("lettersRevealTable").innerHTML = buildLettersSharedTable(data, { voting: false, showResults: false });
    lettersEl("lettersHostNextReveal")?.classList.toggle("hidden", !lettersIsHost);
}

function renderLettersVoting(data) {
    hideAllLettersScreens();
    lettersEl("screen-letters-voting")?.classList.remove("hidden");
    lettersEl("lettersRoundInfoVoting").textContent = `الجولة ${data.current_round} / ${data.total_rounds}`;
    lettersEl("lettersTimerVoting").textContent = buildLettersTimerText(data);
    lettersEl("lettersVotingInfo").textContent = "صوّت على صحة الإجابات. لا يمكنك التصويت على إجابتك.";
    lettersEl("lettersVotingTable").innerHTML = buildLettersSharedTable(data, { voting: true, showResults: false });
    lettersEl("lettersHostNextVoting")?.classList.toggle("hidden", !lettersIsHost);
}

function renderLettersResult(data) {
    hideAllLettersScreens();
    lettersEl("screen-letters-result")?.classList.remove("hidden");
    let lockReason = " - انتهت بانتهاء الوقت";
    if (data.last_round_locked_by === "done") lockReason = " - انتهت بزر الانتهاء";
    if (data.last_round_locked_by === "host") lockReason = " - انتقل المنظّم يدويًا";
    lettersEl("lettersRoundResultInfo").textContent = `حرف الجولة: ${data.last_round_letter || "-"}${lockReason}`;
    lettersEl("lettersResultTable").innerHTML = buildLettersSharedTable(data, { voting: false, showResults: true });
    const tbody = lettersEl("lettersRankingTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";
    [...(data.players || [])].sort((a, b) => b.score - a.score).forEach((player, index) => {
        const delta = data.last_round_score_changes?.[player.id] || 0;
        const row = document.createElement("tr");
        if (index === 0) row.classList.add("rank-gold");
        if (index === 1) row.classList.add("rank-silver");
        if (index === 2) row.classList.add("rank-bronze");
        row.innerHTML = `<td>${index + 1}</td><td>${buildLettersPlayerIdentity(player)}</td><td>${player.score}</td><td>${delta ? `+${delta}` : "-"}</td>`;
        tbody.appendChild(row);
    });
    lettersEl("lettersHostNextResult")?.classList.toggle("hidden", !lettersIsHost);
}

function renderLettersFinished(data) {
    hideAllLettersScreens();
    lettersEl("screen-letters-finished")?.classList.remove("hidden");
    const winners = (data.players || []).filter((player) => (data.winner_ids || []).includes(player.id));
    lettersEl("lettersFinalMsg").textContent = winners.length > 1 ? `تعادل بين: ${winners.map((p) => p.name).join(" / ")}` : `الفائز هو: ${winners[0]?.name || "لا أحد"}`;
    const sortedPlayers = [...(data.players || [])].sort((a, b) => b.score - a.score);

    const podium = lettersEl("lettersPodium");
    if (podium) {
        podium.innerHTML = "";
        sortedPlayers.slice(0, 3).forEach((player, index) => {
            const slot = document.createElement("div");
            slot.className = `letters-podium-card ${index === 0 ? "podium-gold" : index === 1 ? "podium-silver" : "podium-bronze"}`;
            slot.innerHTML = `<div class="letters-podium-rank">#${index + 1}</div><div class="letters-podium-name">${escapeHtml(player.name)}</div><div class="letters-podium-score">${player.score} نقطة</div>`;
            podium.appendChild(slot);
        });
    }

    const tbody = lettersEl("lettersFinalScoreboard");
    if (tbody) {
        tbody.innerHTML = "";
        sortedPlayers.forEach((player, index) => {
            const row = document.createElement("tr");
            if (index === 0) row.classList.add("rank-gold");
            if (index === 1) row.classList.add("rank-silver");
            if (index === 2) row.classList.add("rank-bronze");
            row.innerHTML = `<td>${index + 1}</td><td>${buildLettersPlayerIdentity(player)}</td><td>${player.score}</td>`;
            tbody.appendChild(row);
        });
    }

    lettersEl("lettersGameOverAdminArea")?.classList.toggle("hidden", !lettersIsHost);
    lettersEl("lettersGameOverMemberArea")?.classList.toggle("hidden", lettersIsHost);
}

function buildLettersSharedTable(data, options = {}) {
    const { voting = false, showResults = false } = options;
    const categories = data.active_categories || [];
    const players = data.players || [];
    const entriesByCell = new Map((data.answer_entries || []).map((entry) => [`${entry.player_id}:${entry.category_index}`, entry]));
    return `<div class="table-wrapper"><table class="bluff-table letters-shared-grid-table"><thead><tr><th>اللاعب</th>${categories.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>${players.map((player) => `<tr><td>${buildLettersPlayerIdentity(player)}</td>${categories.map((_, index) => buildLettersAnswerCell(entriesByCell.get(`${player.id}:${index}`), { voting, showResults })).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function buildLettersAnswerCell(entry, options) {
    if (!entry) return "<td>-</td>";
    const answerText = entry.answer_text ? escapeHtml(entry.answer_text) : '<span class="letters-empty-answer">فارغ</span>';
    const resultBadge = options.showResults && entry.final_status ? `<div class="letters-answer-result ${entry.final_status}">${entry.final_status === "valid" ? `صحيحة • ${entry.points_awarded}` : "مرفوضة"}</div>` : "";
    let voteRow = "";
    if (options.voting && !entry.is_empty) {
        const voteButtons = entry.can_vote
            ? `<div class="letters-vote-row"><button type="button" class="btn letters-vote-btn ${entry.my_vote === "valid" ? "active" : ""}" onclick="submitLettersVote('${entry.answer_id}','valid')">صحيحة</button><button type="button" class="btn letters-vote-btn ${entry.my_vote === "invalid" ? "active" : ""}" onclick="submitLettersVote('${entry.answer_id}','invalid')">خطأ</button></div>`
            : "";
        voteRow = `${voteButtons}<div class="letters-vote-counts">✓ ${entry.valid_votes} | ✕ ${entry.invalid_votes}</div>`;
    }
    return `<td><div class="letters-answer-cell">${answerText}${voteRow}${resultBadge}</div></td>`;
}

function renderLettersScoreboard(containerId, players) {
    const tbody = lettersEl(containerId);
    if (!tbody) return;
    tbody.innerHTML = "";
    [...players].sort((a, b) => b.score - a.score).forEach((player) => {
        const row = document.createElement("tr");
        row.innerHTML = `<td>${buildLettersPlayerIdentity(player)}</td><td>${player.score}</td>`;
        tbody.appendChild(row);
    });
}

function buildLettersTimerText(data) {
    if (!data.phase_deadline_at) return data.no_timer ? "بدون مؤقت" : "";
    const secondsLeft = Math.max(0, Math.ceil(data.phase_deadline_at - Date.now() / 1000));
    return `${secondsLeft} ثانية`;
}

function collectLettersAnswers() {
    return Array.from(document.querySelectorAll("#lettersAnswerGrid input")).map((input) => input.value || "");
}

function scheduleLettersAutosave() {
    if (lettersAutosaveTimer) clearTimeout(lettersAutosaveTimer);
    lettersAutosaveTimer = setTimeout(() => submitLettersAnswersDraft(), 300);
}

async function submitLettersAnswersDraft() {
    if (!currentLettersRoomCode || !currentLettersPlayerId || currentLettersRoomData?.phase !== "answering") return;
    const answers = collectLettersAnswers();
    try {
        const data = await executeLettersAction({
            wsType: "submit_answers",
            wsPayload: { answers },
            restPath: `/api/letters/rooms/${currentLettersRoomCode}/answers`,
            restPayload: { player_id: currentLettersPlayerId, answers },
        });
        if (data) applyLettersStateSync(data);
    } catch (error) {
        console.error("Draft submit failed:", error);
    }
}

async function chooseLettersLetter(letter) {
    try {
        const data = await executeLettersAction({
            wsType: "choose_letter",
            wsPayload: { letter },
            restPath: `/api/letters/rooms/${currentLettersRoomCode}/choose-letter`,
            restPayload: { player_id: currentLettersPlayerId, letter },
        });
        if (data) applyLettersStateSync(data);
    } catch (error) {
        showLettersError(error.message || "تعذر اختيار الحرف.");
    }
}

async function pressLettersDone() {
    try {
        const answers = collectLettersAnswers();
        const data = await executeLettersAction({
            wsType: "press_done",
            wsPayload: { answers },
            restPath: `/api/letters/rooms/${currentLettersRoomCode}/done`,
            restPayload: { player_id: currentLettersPlayerId, answers },
        });
        if (data) applyLettersStateSync(data);
    } catch (error) {
        showLettersError(error.message || "تعذر إنهاء الجولة.");
    }
}

async function submitLettersVote(answerId, verdict) {
    try {
        const data = await executeLettersAction({
            wsType: "vote",
            wsPayload: { answer_id: answerId, verdict },
            restPath: `/api/letters/rooms/${currentLettersRoomCode}/vote`,
            restPayload: { player_id: currentLettersPlayerId, answer_id: answerId, verdict },
        });
        if (data) applyLettersStateSync(data);
    } catch (error) {
        showLettersError(error.message || "تعذر إرسال التصويت.");
    }
}

async function nextLettersPhase() {
    if (!currentLettersRoomCode || !currentLettersPlayerId) return;
    try {
        const data = await executeLettersAction({
            wsType: "next_phase",
            wsPayload: {},
            restPath: `/api/letters/rooms/${currentLettersRoomCode}/next-phase`,
            restPayload: { host_id: currentLettersPlayerId },
        });
        if (data) applyLettersStateSync(data);
    } catch (error) {
        showLettersError(error.message || "تعذر الانتقال للمرحلة التالية.");
    }
}

async function startLettersGame() {
    if (!currentLettersRoomData?.active_categories?.length) return showLettersError("اختر تصنيفًا واحدًا على الأقل قبل بدء اللعبة.");
    try {
        const data = await executeLettersAction({
            wsType: "start_game",
            wsPayload: {},
            restPath: `/api/letters/rooms/${currentLettersRoomCode}/start`,
            restPayload: { host_id: currentLettersPlayerId },
        });
        if (data) applyLettersStateSync(data);
    } catch (error) {
        showLettersError(error.message || "تعذر بدء اللعبة.");
    }
}

async function removeLettersPlayer(playerId) {
    try {
        const data = await executeLettersAction({
            wsType: "remove_player",
            wsPayload: { player_id_to_remove: playerId },
            restPath: `/api/letters/rooms/${currentLettersRoomCode}/remove-player`,
            restPayload: { host_id: currentLettersPlayerId, player_id_to_remove: playerId },
        });
        if (data) applyLettersStateSync(data);
    } catch (error) {
        showLettersError(error.message || "تعذر حذف اللاعب.");
    }
}

async function leaveLettersRoom() {
    try {
        if (lettersWS && lettersWS.readyState === WebSocket.OPEN) {
            await sendLettersWSAction("leave", {});
        } else if (currentLettersRoomCode && currentLettersPlayerId) {
            await postLettersJson(`/api/letters/rooms/${currentLettersRoomCode}/leave`, { player_id: currentLettersPlayerId });
        }
    } catch (error) {
        console.error("Leave room failed:", error);
    } finally {
        resetLettersAndExit();
    }
}

async function deleteLettersRoom() {
    if (!currentLettersRoomCode || !currentLettersPlayerId) return;
    const confirmed = await openAppConfirm("هل تريد حذف الغرفة؟", { title: "حذف الغرفة", confirmLabel: "حذف", cancelLabel: "إلغاء", danger: true });
    if (!confirmed) return;
    try {
        await postLettersJson(`/api/letters/rooms/${currentLettersRoomCode}/delete`, { player_id: currentLettersPlayerId });
        resetLettersAndExit();
    } catch (error) {
        showLettersError(error.message || "تعذر حذف الغرفة.");
    }
}

function buildLettersRestartPayloadFromState() {
    const data = currentLettersRoomData;
    return {
        max_player_count: data.max_player_count,
        total_rounds: data.total_rounds,
        answer_timer_seconds: data.answer_timer_seconds,
        no_timer: data.no_timer,
        min_done_seconds: data.min_done_seconds,
        preset_category_ids: data.preset_category_ids || [],
        custom_categories: data.custom_categories || [],
    };
}

async function restartLettersGame() {
    if (!currentLettersRoomData || !currentLettersPlayerId) return;
    try {
        const payload = buildLettersRestartPayloadFromState();
        const data = await executeLettersAction({
            wsType: "restart_game",
            wsPayload: payload,
            restPath: `/api/letters/rooms/${currentLettersRoomCode}/restart`,
            restPayload: { host_id: currentLettersPlayerId, ...payload },
        });
        if (data) applyLettersStateSync(data);
    } catch (error) {
        showLettersError(error.message || "تعذر إعادة تشغيل اللعبة.");
    }
}

function updateLettersDoneAvailability(data = currentLettersRoomData) {
    if (!data || data.phase !== "answering") return;
    const doneButton = lettersEl("lettersDoneButton");
    const doneInfo = lettersEl("lettersDoneInfo");
    if (!doneButton || !doneInfo) return;
    const now = Date.now() / 1000;
    const canDone = !data.done_available_at || now >= data.done_available_at;
    doneButton.disabled = !canDone;
    doneInfo.textContent = canDone ? "يمكنك إنهاء الجولة الآن." : `زر الانتهاء سيفتح بعد ${Math.max(0, Math.ceil(data.done_available_at - now))} ثانية`;
}

function clearLettersLocalState() {
    localStorage.removeItem("letters_room_code");
    localStorage.removeItem("letters_player_id");
    localStorage.removeItem("letters_player_name");
    currentLettersRoomCode = null;
    currentLettersPlayerId = null;
    currentLettersPlayerName = null;
    currentLettersRoomData = null;
    lettersIsHost = false;
    closeLettersWS({ shouldReconnect: false });
    pendingLettersActions.forEach((pending) => pending.reject(new Error("Room reset.")));
    pendingLettersActions.clear();
}

function resetLettersAndExit() {
    clearLettersLocalState();
    window.location.reload();
}

setInterval(async () => {
    const wsReady = lettersWS && lettersWS.readyState === WebSocket.OPEN;
    if (currentLettersRoomCode && currentLettersPlayerId && !wsReady) {
        await refreshLettersRoomState();
    }
}, 3000);

setInterval(async () => {
    if (!currentLettersRoomCode || !currentLettersPlayerId) return;
    try {
        await fetch(`/api/letters/rooms/${currentLettersRoomCode}/heartbeat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ player_id: currentLettersPlayerId }),
        });
    } catch (error) {
        console.error("Letters heartbeat failed:", error);
    }
}, 10000);

setInterval(() => {
    if (!currentLettersRoomData) return;
    if (currentLettersRoomData.phase === "answering") {
        lettersEl("lettersTimerAnswer").textContent = buildLettersTimerText(currentLettersRoomData);
        updateLettersDoneAvailability(currentLettersRoomData);
    }
    if (currentLettersRoomData.phase === "voting") {
        lettersEl("lettersTimerVoting").textContent = buildLettersTimerText(currentLettersRoomData);
    }
}, 1000);

document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (currentLettersRoomCode) return;
    if (!lettersEl("screen-letters-setup")?.classList.contains("hidden")) createLettersRoom();
});
