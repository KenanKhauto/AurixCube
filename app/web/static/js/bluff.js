/**
 * Frontend logic for the Bluff game.
 *
 * Supports:
 * - room creation / joining
 * - host deletion of room
 * - non-host leaving room before game starts
 * - category chooser phase
 * - simultaneous answer submission
 * - answer picking
 * - persistent round results
 * - restart game
 */

let currentBluffRoomCode = localStorage.getItem("bluff_room_code") || null;
let currentBluffPlayerId = localStorage.getItem("bluff_player_id") || null;
let currentBluffPlayerName = localStorage.getItem("bluff_player_name") || null;

let currentBluffRoomData = null;
let bluffIsHost = false;
let lastRenderedBluffSignature = null;

let selectedBluffPlayerCount = null;
let selectedBluffRounds = null;
let selectedBluffCategories = [];
let allBluffCategories = [];
const MAX_CATEGORIES = 12;
let selectedBluffRoundTimer = 30;
const bluffRoundTimerOptions = [
    { value: 30, label: "30 ثانية" },
    { value: 60, label: "60 ثانية" },
    { value: 90, label: "90 ثانية" },
];

let selectedBluffCharacter = localStorage.getItem("bluff_character_id") || "char1";
const bluffCharacterOptions = Array.from({ length: 12 }, (_, i) => `char${i + 1}`);
let bluffFriendCachePrimed = false;

function showBluffError(message) {
    const errorDiv = document.getElementById('bluff-global-error');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideBluffError() {
    const errorDiv = document.getElementById('bluff-global-error');
    errorDiv.classList.add('hidden');
}

async function handleBluffRoomExit(message) {
    clearBluffLocalState();
    await openAppAlert(message, {
        title: "تمت إزالتك",
        confirmLabel: "الخروج",
        danger: true,
    });
    window.location.reload();
}

function ensureCurrentBluffPlayerStillInRoom(data) {
    if ((data.players || []).some((player) => player.id === currentBluffPlayerId)) {
        return true;
    }

    handleBluffRoomExit("تمت إزالتك من الغرفة.");
    return false;
}

function buildBluffRemoveActionCell(playerId, showActions = true) {
    if (showActions && bluffIsHost && playerId !== currentBluffPlayerId) {
        return `<td><button class="btn btn-danger" onclick="removeBluffPlayer('${playerId}')">حذف</button></td>`;
    }
    return "<td></td>";
}

function buildBluffLobbyActionCell(player) {
    const actions = [];
    if (bluffIsHost && player.id !== currentBluffPlayerId) {
        actions.push(`<button class="btn btn-danger" onclick="removeBluffPlayer('${player.id}')">حذف</button>`);
    }
    if (window.appCurrentUser && typeof canSendFriendRequestToUsername === "function" && canSendFriendRequestToUsername(player.username)) {
        const encodedUsername = encodeURIComponent(player.username);
        actions.push(`<button class="btn" onclick="sendBluffFriendRequest('${encodedUsername}', this)">Add Friend</button>`);
    }
    if (!actions.length) return "<td></td>";
    return `<td>${actions.join(" ")}</td>`;
}

async function sendBluffFriendRequest(encodedUsername, buttonEl) {
    const username = decodeURIComponent(encodedUsername || "");
    if (!username || typeof sendFriendRequestByUsername !== "function") return;
    if (buttonEl) buttonEl.disabled = true;
    try {
        const success = await sendFriendRequestByUsername(username);
        if (success && buttonEl) {
            buttonEl.textContent = "Requested";
            buttonEl.classList.add("disabled");
        } else if (buttonEl) {
            buttonEl.disabled = false;
        }
    } catch (error) {
        if (buttonEl) buttonEl.disabled = false;
        console.error("Failed to send friend request:", error);
    }
}

async function primeBluffFriendCache() {
    if (bluffFriendCachePrimed || !window.appCurrentUser || typeof ensureAppFriendCache !== "function") return;
    await ensureAppFriendCache();
    bluffFriendCachePrimed = true;
    if (currentBluffRoomData && (!currentBluffRoomData.started || currentBluffRoomData.phase === "waiting")) {
        renderBluffWaitingRoom(currentBluffRoomData);
    }
}

function renderBluffLobbyCharacterPicker(data) {
    const grid = document.getElementById("bluffWaitCharacterGrid");
    const preview = document.getElementById("bluffWaitCharacterPreview");
    if (!grid || !preview) return;

    const me = (data.players || []).find((player) => player.id === currentBluffPlayerId);
    const activeCharacterId = me?.character_id || selectedBluffCharacter || "char1";
    selectedBluffCharacter = activeCharacterId;
    localStorage.setItem("bluff_character_id", selectedBluffCharacter);

    preview.src = `/static/images/${activeCharacterId}.png`;
    grid.innerHTML = "";

    bluffCharacterOptions.forEach((characterId) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "character-btn";
        button.dataset.characterId = characterId;
        button.classList.toggle("active", characterId === activeCharacterId);
        button.onclick = () => updateBluffLobbyCharacter(characterId);
        button.innerHTML = `<img src="/static/images/${characterId}.png" class="character-btn-img" alt="${characterId}">`;
        grid.appendChild(button);
    });
}

async function updateBluffLobbyCharacter(characterId) {
    if (!currentBluffRoomCode || !currentBluffPlayerId) return;
    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/character`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            player_id: currentBluffPlayerId,
            character_id: characterId,
        }),
    });
    const data = await response.json();
    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "Unable to update character."));
        return;
    }
    selectedBluffCharacter = characterId;
    localStorage.setItem("bluff_character_id", selectedBluffCharacter);
    currentBluffRoomData = data;
    renderBluffWaitingRoom(data);
}

const bluffPlayerCountOptions = [2, 3, 4, 5, 6, 7, 8, 9, 10];

const bluffCategoryLabels = {
    capitals: "دول",
    strange_facts: "معلومات غريبة",
    football: "كرة قدم",
    prophets: "أنبياء",
    quran: "القرآن",
    companions_of_the_prophet: "أصحاب الرسول",
    animals: "حيوانات",
    history: "تاريخ",
    general: "معلومات عامة",
    syria: "سوريا",
    proverbs: "أمثال شامية",
    player_career: "مسيرة لاعب",
    gaming: "ألعاب الفيديو",

};

document.addEventListener("DOMContentLoaded", async () => {
    await primeBluffFriendCache();
    renderBluffPlayerCountButtons();
    renderBluffRoundsButtons();
    await loadBluffCategories();
    renderBluffCharacterButtons();
    renderBluffRoundTimerButtons();

    const nameInput = document.getElementById("bluffName");
    const defaultLobbyName = typeof getDefaultLobbyName === "function" ? getDefaultLobbyName() : "";
    const initialName = currentBluffPlayerName || defaultLobbyName;
    if (nameInput && defaultLobbyName) {
        nameInput.placeholder = defaultLobbyName;
    }
    if (nameInput && initialName && !nameInput.value.trim()) {
        nameInput.value = initialName;
    }

    if (currentBluffRoomCode) {
        const roomInput = document.getElementById("bluffRoomInput");
        if (roomInput) roomInput.value = currentBluffRoomCode;
    }

    if (currentBluffRoomCode && currentBluffPlayerId) {
        await refreshBluffRoomState();
    }
});


function renderBluffRoundTimerButtons() {
    const container = document.getElementById("bluffTimerGrid");
    if (!container) return;

    container.innerHTML = "";

    bluffRoundTimerOptions.forEach((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.timerValue = String(option.value);
        button.textContent = option.label;
        button.onclick = () => selectBluffRoundTimer(option.value);
        container.appendChild(button);
    });

    updateBluffRoundTimerButtonsState();
}

function selectBluffRoundTimer(seconds) {
    selectedBluffRoundTimer = seconds;
    updateBluffRoundTimerButtonsState();
}

function updateBluffRoundTimerButtonsState() {
    const buttons = document.querySelectorAll("#bluffTimerGrid .category-btn");

    buttons.forEach((btn) => {
        const value = Number(btn.dataset.timerValue);
        btn.classList.toggle("active", value === selectedBluffRoundTimer);
    });
}

function renderBluffCharacterButtons() {
    const container = document.getElementById("bluffCharacterGrid");
    if (!container) return;

    container.innerHTML = "";

    bluffCharacterOptions.forEach((characterId) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "character-btn";
        button.dataset.characterId = characterId;
        button.onclick = () => selectBluffCharacter(characterId);

        button.innerHTML = `
            <img src="/static/images/${characterId}.png" class="character-btn-img" alt="${characterId}">
        `;

        container.appendChild(button);
    });

    updateBluffCharacterButtonsState();
}

function selectBluffCharacter(characterId) {
    selectedBluffCharacter = characterId;
    localStorage.setItem("bluff_character_id", selectedBluffCharacter);
    updateBluffCharacterButtonsState();
}

function updateBluffCharacterButtonsState() {
    const buttons = document.querySelectorAll("#bluffCharacterGrid .character-btn");

    buttons.forEach((btn) => {
        const characterId = btn.dataset.characterId;
        btn.classList.toggle("active", characterId === selectedBluffCharacter);
    });

    const preview = document.getElementById("bluffCharacterPreview");
    if (preview) {
        preview.src = `/static/images/${selectedBluffCharacter}.png`;
    }
}

function buildBluffPlayerIdentity(player) {
    return `
        <div class="bluff-player-identity">
            <img src="/static/images/${player.character_id || 'char1'}.png" class="bluff-player-avatar" alt="${escapeHtml(player.name)}">
            <div class="bluff-player-text">
                <span class="bluff-player-name">${escapeHtml(player.name)}</span>
            </div>
        </div>
    `;
}

function getBluffPlayerStatusText(player, data, mode) {
    const submittedIds = new Set(data.submitted_player_ids || []);
    const pickedIds = new Set(data.picked_player_ids || []);

    if (mode === "category_pick") {
        if (player.id === data.current_category_chooser_id) {
            return "يختار التصنيف الآن";
        }
        return "بانتظار الدور";
    }

    if (mode === "submission") {
        return submittedIds.has(player.id) ? "أرسل الإجابة" : "لم يرسل بعد";
    }

    if (mode === "answer_pick") {
        return pickedIds.has(player.id) ? "اختار إجابة" : "لم يختر بعد";
    }

    return "-";
}

async function loadBluffCategories() {
    const response = await fetch("/api/bluff/categories");
    const data = await response.json();
    allBluffCategories = data.categories || [];
}

function renderBluffPlayerCountButtons() {
    const container = document.getElementById("bluffPlayerCountGrid");
    if (!container) return;

    container.innerHTML = "";

    bluffPlayerCountOptions.forEach((count) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.playerCount = String(count);
        button.textContent = `${count} لاعبين`;
        button.onclick = () => {
            selectedBluffPlayerCount = count;
            if (selectedBluffRounds && selectedBluffRounds < count) {
                selectedBluffRounds = count;
            }
            updateBluffPlayerCountButtonsState();
            renderBluffRoundsButtons();
            updateBluffRoundsButtonsState();
        };
        container.appendChild(button);
    });

    updateBluffPlayerCountButtonsState();
}

function updateBluffPlayerCountButtonsState() {
    const buttons = document.querySelectorAll("#bluffPlayerCountGrid .category-btn");
    buttons.forEach((btn) => {
        const count = Number(btn.dataset.playerCount);
        btn.classList.toggle("active", count === selectedBluffPlayerCount);
    });
}

function renderBluffRoundsButtons() {
    const container = document.getElementById("bluffRoundsGrid");
    if (!container) return;

    container.innerHTML = "";

    let options = [];
    if (selectedBluffPlayerCount) {
        for (let i = selectedBluffPlayerCount; i <= 30; i += selectedBluffPlayerCount) {
            options.push(i);
        }
    } else {
        options = [2, 5, 10, 15, 20, 25, 30];
    }

    options.forEach((rounds) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.rounds = String(rounds);
        button.textContent = `${rounds} جولات`;
        button.onclick = () => {
            selectedBluffRounds = rounds;
            updateBluffRoundsButtonsState();
        };
        container.appendChild(button);
    });

    if (selectedBluffRounds && !options.includes(selectedBluffRounds)) {
        selectedBluffRounds = options[0] || null;
    }

    updateBluffRoundsButtonsState();
}

function updateBluffRoundsButtonsState() {
    const buttons = document.querySelectorAll("#bluffRoundsGrid .category-btn");

    buttons.forEach((btn) => {
        const rounds = Number(btn.dataset.rounds);
        const disabledBecauseTooLow = selectedBluffPlayerCount && rounds < selectedBluffPlayerCount;

        btn.disabled = !!disabledBecauseTooLow;
        btn.classList.toggle("disabled", !!disabledBecauseTooLow);
        btn.classList.toggle("active", rounds === selectedBluffRounds);

        if (disabledBecauseTooLow && rounds === selectedBluffRounds) {
            selectedBluffRounds = null;
        }
    });
}

function toggleBluffCategory(categoryKey) {
    const isSelected = selectedBluffCategories.includes(categoryKey);

    if (isSelected) {
        selectedBluffCategories = selectedBluffCategories.filter((c) => c !== categoryKey);
    } else {
        if (selectedBluffCategories.length >= MAX_CATEGORIES) {
            showBluffError(`يمكنك اختيار ${MAX_CATEGORIES} تصنيفات كحد أقصى`);
            return;
        }
        selectedBluffCategories.push(categoryKey);
    }

    updateBluffCategoryButtonsState();
}

function updateBluffCategoryButtonsState() {
    const info = document.getElementById("bluffCategorySelectionInfo");
    if (info) {
        info.textContent = `تم اختيار ${selectedBluffCategories.length} / ${MAX_CATEGORIES}`;
    }

    const buttons = document.querySelectorAll("#bluffCategoryGrid .category-btn");

    buttons.forEach((btn) => {
        const key = btn.dataset.categoryKey;
        const isSelected = selectedBluffCategories.includes(key);

        btn.classList.toggle("active", isSelected);

        if (!isSelected && selectedBluffCategories.length >= MAX_CATEGORIES) {
            btn.classList.add("disabled");
            btn.disabled = true;
        } else {
            btn.classList.remove("disabled");
            btn.disabled = false;
        }
    });
}

async function toggleBluffCategory(categoryKey) {
    if (!bluffIsHost || currentBluffRoomData?.started) return;

    const isSelected = selectedBluffCategories.includes(categoryKey);
    let nextCategories;

    if (isSelected) {
        nextCategories = selectedBluffCategories.filter((c) => c !== categoryKey);
    } else {
        if (selectedBluffCategories.length >= MAX_CATEGORIES) {
            showBluffError(`\u064a\u0645\u0643\u0646\u0643 \u0627\u062e\u062a\u064a\u0627\u0631 ${MAX_CATEGORIES} \u062a\u0635\u0646\u064a\u0641\u0627\u062a \u0643\u062d\u062f \u0623\u0642\u0635\u0649`);
            return;
        }
        nextCategories = [...selectedBluffCategories, categoryKey];
    }

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            host_id: currentBluffPlayerId,
            categories: nextCategories
        })
    });

    const data = await response.json();

    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "\u062a\u0639\u0630\u0631 \u062a\u062d\u062f\u064a\u062b \u0627\u0644\u062a\u0635\u0646\u064a\u0641\u0627\u062a."));
        return;
    }

    currentBluffRoomData = data;
    bluffIsHost = currentBluffPlayerId === data.host_id;
    lastRenderedBluffSignature = null;
    renderBluffWaitingRoom(data);
}

function renderBluffPregameCategories(data) {
    const info = document.getElementById("bluffCategorySelectionInfo");
    if (info) {
        info.textContent = `\u062a\u0645 \u0627\u062e\u062a\u064a\u0627\u0631 ${selectedBluffCategories.length} / ${MAX_CATEGORIES}`;
    }

    const pregameInfo = document.getElementById("bluffPregameInfo");
    if (pregameInfo) {
        if (bluffIsHost) {
            pregameInfo.textContent = "\u0627\u062e\u062a\u0631 \u0627\u0644\u062a\u0635\u0646\u064a\u0641\u0627\u062a \u0627\u0644\u0645\u0633\u0645\u0648\u062d\u0629 \u0642\u0628\u0644 \u0628\u062f\u0621 \u0627\u0644\u0644\u0639\u0628\u0629.";
        } else {
            const host = data.players.find((player) => player.id === data.host_id);
            pregameInfo.textContent = host
                ? `${host.name} \u064a\u062e\u062a\u0627\u0631 \u0627\u0644\u062a\u0635\u0646\u064a\u0641\u0627\u062a \u0627\u0644\u0622\u0646`
                : "\u0628\u0627\u0646\u062a\u0638\u0627\u0631 \u0627\u062e\u062a\u064a\u0627\u0631 \u0627\u0644\u062a\u0635\u0646\u064a\u0641\u0627\u062a";
        }
    }

    const container = document.getElementById("bluffCategoryGrid");
    if (!container) return;

    container.innerHTML = "";

    allBluffCategories.forEach((key) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.categoryKey = key;
        button.textContent = bluffCategoryLabels[key] || key;

        const isSelected = selectedBluffCategories.includes(key);
        const disableBecauseLimit = !isSelected && selectedBluffCategories.length >= MAX_CATEGORIES;

        button.classList.toggle("active", isSelected);
        button.classList.toggle("disabled", !bluffIsHost || disableBecauseLimit);
        button.disabled = !bluffIsHost || disableBecauseLimit;

        if (bluffIsHost) {
            button.onclick = () => toggleBluffCategory(key);
        }

        container.appendChild(button);
    });
}

function showBluffSetup() {
    const name = document.getElementById("bluffName").value.trim();

    if (!name) {
        showBluffError("الرجاء إدخال اسمك أولاً!");
        return;
    }

    currentBluffPlayerName = name;
    localStorage.setItem("bluff_player_name", currentBluffPlayerName);

    hideAllBluffScreens();
    document.getElementById("screen-bluff-setup").classList.remove("hidden");
}

function goBackToBluffLobby() {
    hideAllBluffScreens();
    document.getElementById("screen-bluff-lobby").classList.remove("hidden");
}

async function createBluffRoom() {
    const hostName = document.getElementById("bluffName").value.trim();
    const playerCount = selectedBluffPlayerCount;
    const totalRounds = selectedBluffRounds;

    if (!hostName) {
        showBluffError("الرجاء إدخال الاسم أولاً!");
        return;
    }

    if (!playerCount) {
        showBluffError("اختر عدد اللاعبين أولاً!");
        return;
    }

    if (!totalRounds) {
        showBluffError("اختر عدد الجولات أولاً!");
        return;
    }

    if (totalRounds < playerCount) {
        showBluffError("عدد الجولات يجب أن يكون على الأقل بعدد اللاعبين.");
        return;
    }

    if (selectedBluffCategories.length === 0) {
        showBluffError("اختر تصنيفاً واحداً على الأقل!");
        return;
    }

    const response = await fetch("/api/bluff/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            host_name: hostName,
            character_id: selectedBluffCharacter,
            max_player_count: playerCount,
            total_rounds: totalRounds,
            categories: [],
            round_timer_seconds: selectedBluffRoundTimer
        })
    });

    const data = await response.json();

    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "حدث خطأ أثناء إنشاء الغرفة."));
        return;
    }

    currentBluffRoomCode = data.room_code;
    currentBluffPlayerId = data.host_id;
    currentBluffPlayerName = hostName;
    currentBluffRoomData = data;
    bluffIsHost = true;
    lastRenderedBluffSignature = null;

    localStorage.setItem("bluff_room_code", currentBluffRoomCode);
    localStorage.setItem("bluff_player_id", currentBluffPlayerId);
    localStorage.setItem("bluff_player_name", currentBluffPlayerName);

    hideBluffError();
    renderBluffWaitingRoom(data);
}

async function joinBluffRoom() {
    const name = document.getElementById("bluffName").value.trim();
    const roomCode = document.getElementById("bluffRoomInput").value.trim().toUpperCase();

    if (!name || !roomCode) {
        showBluffError("اكمل البيانات!");
        return;
    }

    const response = await fetch(`/api/bluff/rooms/${roomCode}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            player_name: name,
            character_id: selectedBluffCharacter, 
        })
    });

    const data = await response.json();

    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر الانضمام إلى الغرفة."));
        return;
    }

    const joinedPlayer = data.players.find(
        (player) => player.name === name && player.id !== data.host_id
    ) || data.players[data.players.length - 1];

    currentBluffRoomCode = roomCode;
    currentBluffPlayerId = joinedPlayer.id;
    currentBluffPlayerName = name;
    currentBluffRoomData = data;
    bluffIsHost = currentBluffPlayerId === data.host_id;
    lastRenderedBluffSignature = null;

    localStorage.setItem("bluff_room_code", currentBluffRoomCode);
    localStorage.setItem("bluff_player_id", currentBluffPlayerId);
    localStorage.setItem("bluff_player_name", currentBluffPlayerName);

    hideBluffError();
    renderBluffState(data);
}

async function startBluffGame() {
    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/start`, {
        method: "POST"
    });

    const data = await response.json();

    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر بدء اللعبة."));
        return;
    }

    currentBluffRoomData = data;
    bluffIsHost = currentBluffPlayerId === data.host_id;
    lastRenderedBluffSignature = null;

    renderBluffState(data);
}

async function selectBluffRoundCategory(category) {
    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/select-category`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            player_id: currentBluffPlayerId,
            category: category
        })
    });

    const data = await response.json();

    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر اختيار التصنيف."));
        return;
    }

    currentBluffRoomData = data;
    bluffIsHost = currentBluffPlayerId === data.host_id;
    lastRenderedBluffSignature = null;

    renderBluffState(data);
}

async function submitBluffAnswer() {
    const input = document.getElementById("bluffAnswerInput");
    const answerText = input.value.trim();

    if (!answerText) {
        showBluffError("اكتب إجابة أولاً.");
        return;
    }

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/submit-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            player_id: currentBluffPlayerId,
            answer_text: answerText
        })
    });

    const data = await response.json();

    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر إرسال الإجابة."));
        return;
    }

    currentBluffRoomData = data;
    bluffIsHost = currentBluffPlayerId === data.host_id;
    lastRenderedBluffSignature = null;

    input.value = "";
    renderBluffState(data);
}

async function submitBluffPick(optionId) {
    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/submit-pick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            player_id: currentBluffPlayerId,
            option_id: optionId
        })
    });

    const data = await response.json();

    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر إرسال الاختيار."));
        return;
    }

    currentBluffRoomData = data;
    bluffIsHost = currentBluffPlayerId === data.host_id;
    lastRenderedBluffSignature = null;

    renderBluffState(data);
}

async function advanceBluffRound() {
    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            player_id: currentBluffPlayerId
        })
    });

    const data = await response.json();

    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر الانتقال للجولة التالية."));
        return;
    }

    currentBluffRoomData = data;
    bluffIsHost = currentBluffPlayerId === data.host_id;
    lastRenderedBluffSignature = null;

    renderBluffState(data);
}

async function restartBluffGame() {
    const totalRounds = selectedBluffRounds || currentBluffRoomData?.total_rounds;
    const categories = selectedBluffCategories.length > 0
        ? selectedBluffCategories
        : currentBluffRoomData?.categories || [];

    if (!totalRounds) {
        showBluffError("اختر عدد الجولات أولاً!");
        return;
    }

    if (categories.length === 0) {
        showBluffError("اختر تصنيفاً واحداً على الأقل!");
        return;
    }

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            categories,
            total_rounds: totalRounds,
            round_timer_seconds: selectedBluffRoundTimer || currentBluffRoomData?.round_timer_seconds || 30
        })
    });

    const data = await response.json();

    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر إعادة اللعبة."));
        return;
    }

    currentBluffRoomData = data;
    bluffIsHost = currentBluffPlayerId === data.host_id;
    lastRenderedBluffSignature = null;
    renderBluffWaitingRoom(data);
}

async function leaveBluffRoom() {
    if (!currentBluffRoomCode || !currentBluffPlayerId) return;

    const confirmed = confirm("هل أنت متأكد أنك تريد الخروج من الغرفة؟");
    if (!confirmed) return;

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            player_id: currentBluffPlayerId
        })
    });

    const data = await response.json();

    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر الخروج من الغرفة."));
        return;
    }

    clearBluffLocalState();
    window.location.reload();
}

async function deleteBluffRoom() {
    if (!currentBluffRoomCode || !currentBluffPlayerId) return;

    const confirmed = await openAppConfirm("هل أنت متأكد أنك تريد حذف الغرفة بالكامل؟", {
        title: "حذف الغرفة",
        confirmLabel: "حذف الغرفة",
        cancelLabel: "إلغاء",
        danger: true,
    });
    if (!confirmed) return;

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            player_id: currentBluffPlayerId
        })
    });

    const data = await response.json();

    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر حذف الغرفة."));
        return;
    }

    clearBluffLocalState();
    window.location.reload();
}

async function removeBluffPlayer(playerIdToRemove) {
    const confirmed = await openAppConfirm("هل أنت متأكد أنك تريد حذف هذا اللاعب من الغرفة؟", {
        title: "حذف لاعب",
        confirmLabel: "حذف اللاعب",
        cancelLabel: "إلغاء",
        danger: true,
    });
    if (!confirmed) return;

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/remove-player`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            host_id: currentBluffPlayerId,
            player_id_to_remove: playerIdToRemove
        })
    });

    const data = await response.json();

    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر حذف اللاعب."));
        return;
    }

    hideBluffError();
    renderBluffState(data);
}

async function refreshBluffRoomState() {
    if (!currentBluffRoomCode) return;

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}`);
    if (!response.ok) {
        if (response.status === 404) {
            await handleBluffRoomExit("تم حذف الغرفة أو لم تعد متاحة.");
        }
        return;
    }

    const data = await response.json();
    if (!ensureCurrentBluffPlayerStillInRoom(data)) return;

    currentBluffRoomData = data;
    bluffIsHost = currentBluffPlayerId === data.host_id;

    const signature = buildBluffStateSignature(data);
    if (signature === lastRenderedBluffSignature) {
        updateBluffLiveTimer(data);
        return;
    }

    lastRenderedBluffSignature = signature;
    renderBluffState(data);
}

function renderBluffState(data) {
    currentBluffRoomData = data;

    if (data.ended || data.phase === "game_over") {
        renderBluffGameOver(data);
        updateBluffRoomActionButtons();
        return;
    }

    if (!data.started || data.phase === "waiting") {
        renderBluffWaitingRoom(data);
        updateBluffRoomActionButtons();
        return;
    }

    if (data.phase === "category_pick") {
        renderBluffCategoryPickPhase(data);
        updateBluffRoomActionButtons();
        return;
    }

    if (data.phase === "submission") {
        renderBluffSubmissionPhase(data);
        updateBluffRoomActionButtons();
        return;
    }

    if (data.phase === "answer_pick") {
        renderBluffAnswerPickPhase(data);
        updateBluffRoomActionButtons();
        return;
    }

    if (data.phase === "round_result") {
        renderBluffRoundResult(data);
        updateBluffRoomActionButtons();
    }
}

function updateBluffRoomActionButtons() {
    document.querySelectorAll(".room-leave-button").forEach((button) => {
        button.classList.toggle("hidden", bluffIsHost);
    });
    document.querySelectorAll(".room-delete-button").forEach((button) => {
        button.classList.toggle("hidden", !bluffIsHost);
    });
}

function buildBluffStateSignature(data) {
    const playersSignature = data.players
        .map((player) => `${player.id}:${player.score}:${player.character_id || ""}`)
        .join("|");

    const categoriesSignature = (data.categories || []).join("|");

    const optionsSignature = (data.answer_options || [])
        .map((option) => `${option.id}:${option.votes_received}`)
        .join("|");

    return JSON.stringify({
        started: data.started,
        ended: data.ended,
        phase: data.phase,
        current_round: data.current_round,
        current_category_chooser_id: data.current_category_chooser_id,
        current_round_category: data.current_round_category,
        current_question: data.current_question,
        categories: categoriesSignature,
        submissions_count: data.submissions_count,
        picks_count: data.picks_count,
        submitted_player_ids: data.submitted_player_ids,
        picked_player_ids: data.picked_player_ids,
        phase_deadline_at: data.phase_deadline_at,
        last_round_message: data.last_round_message,
        last_round_correct_option_id: data.last_round_correct_option_id,
        winner_ids: data.winner_ids,
        players: playersSignature,
        options: optionsSignature
    });
}

function renderBluffWaitingRoom(data) {
    hideAllBluffScreens();
    document.getElementById("screen-bluff-wait").classList.remove("hidden");

    document.getElementById("bluffDisplayCode").textContent = data.room_code;

    const actionsHeader = document.getElementById("bluffActionsHeader");
    const showLobbyActions = bluffIsHost || Boolean(window.appCurrentUser);
    if (actionsHeader) {
        actionsHeader.style.display = showLobbyActions ? "" : "none";
    }

    const playerList = document.getElementById("bluffPlayerList");
    playerList.innerHTML = "";

    [...data.players]
        .sort((a, b) => b.score - a.score)
        .forEach((player) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${buildBluffPlayerIdentity(player)}</td>
                <td>${player.score}</td>
                ${buildBluffLobbyActionCell(player)}
            `;
            playerList.appendChild(row);
        });

    const hostArea = document.getElementById("bluffHostArea");
    const memberArea = document.getElementById("bluffMemberArea");

    if (bluffIsHost) {
        hostArea.classList.remove("hidden");
        memberArea.classList.add("hidden");
    } else {
        hostArea.classList.add("hidden");
        memberArea.classList.remove("hidden");
    }
}

function renderBluffCategoryPickPhase(data) {
    hideAllBluffScreens();
    document.getElementById("screen-bluff-category-pick").classList.remove("hidden");

    document.getElementById("bluffRoundInfoCategoryPick").textContent =
        `الجولة ${data.current_round} / ${data.total_rounds}`;

    const chooser = data.players.find((p) => p.id === data.current_category_chooser_id);
    const chooserName = chooser ? chooser.name : "لاعب";

    document.getElementById("bluffCategoryChooserInfo").textContent =
        data.current_category_chooser_id === currentBluffPlayerId
            ? "اختر تصنيف هذه الجولة"
            : `${chooserName} يختار التصنيف الآن`;

    const container = document.getElementById("bluffRoundCategoryGrid");
    container.innerHTML = "";

    (data.categories || []).forEach((categoryKey) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.textContent = bluffCategoryLabels[categoryKey] || categoryKey;
        button.disabled = data.current_category_chooser_id !== currentBluffPlayerId;
        button.onclick = () => selectBluffRoundCategory(categoryKey);
        container.appendChild(button);
    });

    renderBluffPlayerStatusList(data, "bluffPlayerStatusCategoryPick", "category_pick");
    renderBluffScoreboard(data.players, "bluffScoreboardCategoryPick", false, true);
}

function renderBluffSubmissionPhase(data) {
    hideAllBluffScreens();
    document.getElementById("screen-bluff-submission").classList.remove("hidden");

    document.getElementById("bluffRoundInfoSubmission").textContent =
        `الجولة ${data.current_round} / ${data.total_rounds}`;

    document.getElementById("bluffSubmissionCategoryLabel").textContent =
        bluffCategoryLabels[data.current_round_category] || data.current_round_category || "-";

    document.getElementById("bluffQuestionBoxSubmission").textContent = data.current_question;
    document.getElementById("bluffSubmissionsInfo").textContent =
        `تم إرسال ${data.submissions_count} من ${data.players.length}`;

    renderBluffTimer("bluffTimerSubmission", data.phase_deadline_at);

    const mySubmitted = (data.submitted_player_ids || []).includes(currentBluffPlayerId);
    const answerInput = document.getElementById("bluffAnswerInput");
    const answerButton = document.getElementById("bluffSubmitAnswerBtn");

    answerInput.disabled = mySubmitted;
    answerButton.disabled = mySubmitted;

    if (mySubmitted) {
        answerInput.placeholder = "تم إرسال إجابتك";
    } else {
        answerInput.placeholder = "اكتب إجابة خادعة تبدو صحيحة...";
    }

    renderBluffPlayerStatusList(data, "bluffPlayerStatusSubmission", "submission");
    renderBluffScoreboard(data.players, "bluffScoreboardSubmission", false, true);
}

function renderBluffAnswerPickPhase(data) {
    hideAllBluffScreens();
    document.getElementById("screen-bluff-answer-pick").classList.remove("hidden");

    document.getElementById("bluffRoundInfoAnswerPick").textContent =
        `الجولة ${data.current_round} / ${data.total_rounds}`;

    document.getElementById("bluffAnswerPickCategoryLabel").textContent =
        bluffCategoryLabels[data.current_round_category] || data.current_round_category || "-";

    document.getElementById("bluffQuestionBoxAnswerPick").textContent = data.current_question;
    document.getElementById("bluffPicksInfo").textContent =
        `تم الاختيار من ${data.picks_count} من ${data.players.length}`;

    renderBluffTimer("bluffTimerAnswerPick", data.phase_deadline_at);
    renderBluffPlayerStatusList(data, "bluffPlayerStatusAnswerPick", "answer_pick");

    const optionsContainer = document.getElementById("bluffOptionsContainer");
    optionsContainer.innerHTML = "";

    const myPick = findMyPickFromRoomState(data);

    data.answer_options.forEach((option) => {
        const isOwnOption = option.author_ids.includes(currentBluffPlayerId);
        const isSelected = myPick === option.id;

        const button = document.createElement("button");
        button.className = "bluff-answer-card";
        button.disabled = isOwnOption;
        if (isSelected) button.classList.add("selected");
        if (isOwnOption) button.classList.add("own-answer");

        button.innerHTML = `
            <div class="bluff-answer-text">${option.text}</div>
            ${isOwnOption ? '<div class="bluff-answer-meta">إجابتك</div>' : ''}
            ${isSelected ? '<div class="bluff-answer-meta">تم الاختيار</div>' : ''}
        `;

        if (!isOwnOption) {
            button.onclick = () => submitBluffPick(option.id);
        }

        optionsContainer.appendChild(button);
    });

    renderBluffScoreboard(data.players, "bluffScoreboardAnswerPick", false, true);
}

function renderBluffRoundResult(data) {
    hideAllBluffScreens();
    document.getElementById("screen-bluff-result").classList.remove("hidden");


    renderBluffAnswersResultTable(data);
    renderBluffRankingResultTable(data);

    const advanceArea = document.getElementById("bluffAdvanceArea");
    advanceArea.innerHTML = "";

    if (bluffIsHost) {
        const nextButton = document.createElement("button");
        nextButton.className = "btn btn-primary";
        nextButton.textContent = data.current_round >= data.total_rounds
            ? "إنهاء اللعبة"
            : "الجولة التالية";
        nextButton.onclick = advanceBluffRound;
        advanceArea.appendChild(nextButton);
    } else {
        const waitText = document.createElement("p");
        waitText.textContent = "بانتظار صاحب الغرفة للانتقال...";
        advanceArea.appendChild(waitText);
    }
}

function renderBluffAnswersResultTable(data) {
    const tbody = document.getElementById("bluffAnswersTableBody");
    if (!tbody) return;

    tbody.innerHTML = "";
    const picks = data.picks || {};

    (data.answer_options || []).forEach((option) => {
        const row = document.createElement("tr");

        const authorNames = (option.author_ids || []).length > 0
            ? option.author_ids
                .map((authorId) => {
                    const player = data.players.find((p) => p.id === authorId);
                    return player ? player.name : "لاعب غير معروف";
                })
                .join(" / ")
            : "الإجابة الصحيحة";

        const pickerNames = Object.entries(picks)
            .filter(([, optionId]) => optionId === option.id)
            .map(([playerId]) => {
                const player = data.players.find((p) => p.id === playerId);
                return player ? player.name : "لاعب غير معروف";
            })
            .join(" / ") || "-";


        if (option.id === data.last_round_correct_option_id) {
            row.classList.add("correct-answer-row");
        }

        row.innerHTML = `
            <td>${escapeHtml(option.text)}</td>
            <td>${escapeHtml(authorNames)}</td>
            <td>${option.votes_received ?? 0}</td>
            <td>${escapeHtml(pickerNames)}</td>
        `;

        tbody.appendChild(row);
    });
}

function renderBluffRankingResultTable(data) {
    const tbody = document.getElementById("bluffRankingTableBody");
    if (!tbody) return;

    tbody.innerHTML = "";

    const changes = data.last_round_score_changes || {};
    const sortedPlayers = [...data.players].sort((a, b) => b.score - a.score);

    sortedPlayers.forEach((player, index) => {
        const row = document.createElement("tr");
        const delta = changes[player.id] || 0;

        if (index === 0) row.classList.add("rank-gold");
        if (index === 1) row.classList.add("rank-silver");
        if (index === 2) row.classList.add("rank-bronze");

        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${buildBluffPlayerIdentity(player, false)}</td>
            <td>${player.score}</td>
            <td>${delta > 0 ? `+${delta}` : "-"}</td>
            ${buildBluffRemoveActionCell(player.id)}
        `;

        tbody.appendChild(row);
    });
}
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderBluffGameOver(data) {
    hideAllBluffScreens();
    document.getElementById("screen-bluff-game-over").classList.remove("hidden");

    // Handle insufficient players
    if (data.end_reason === "insufficient_players") {
        document.getElementById("bluffFinalMsg").textContent = 
            "انتهت اللعبة! عدد اللاعبين غير كافي للمتابعة.";
        
        renderBluffScoreboard(data.players, "bluffScoreboardFinal", true, true);
        
        const adminArea = document.getElementById("bluffGameOverAdminArea");
        const memberArea = document.getElementById("bluffGameOverMemberArea");

        if (bluffIsHost) {
            adminArea.classList.remove("hidden");
            memberArea.classList.add("hidden");
        } else {
            adminArea.classList.add("hidden");
            memberArea.classList.remove("hidden");
        }
        return;
    }

    // Normal game over
    const winners = data.players.filter((player) => data.winner_ids.includes(player.id));
    const winnerNames = winners.map((player) => player.name).join(" / ");

    document.getElementById("bluffFinalMsg").textContent =
        winners.length > 1
            ? `انتهت اللعبة! تعادل بين: ${winnerNames}`
            : `الفائز هو: ${winnerNames}`;

    renderBluffScoreboard(data.players, "bluffScoreboardFinal", true, true);

    const adminArea = document.getElementById("bluffGameOverAdminArea");
    const memberArea = document.getElementById("bluffGameOverMemberArea");

    if (bluffIsHost) {
        adminArea.classList.remove("hidden");
        memberArea.classList.add("hidden");
    } else {
        adminArea.classList.add("hidden");
        memberArea.classList.remove("hidden");
    }
}

function renderBluffPlayerStatusList(data, containerId, mode) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const submittedIds = new Set(data.submitted_player_ids || []);
    const pickedIds = new Set(data.picked_player_ids || []);

    container.innerHTML = "";

    data.players.forEach((player) => {
        const row = document.createElement("tr");

        let rowClass = "";
        if (mode === "submission" && submittedIds.has(player.id)) {
            rowClass = "bluff-player-done-row";
        }
        if (mode === "answer_pick" && pickedIds.has(player.id)) {
            rowClass = "bluff-player-done-row";
        }
        if (mode === "category_pick" && player.id === data.current_category_chooser_id) {
            rowClass = "bluff-player-current-row";
        }

        row.className = rowClass;
        row.innerHTML = `
            <td>${buildBluffPlayerIdentity(player)}</td>
            <td>${getBluffPlayerStatusText(player, data, mode)}</td>
        `;

        container.appendChild(row);
    });
}

function renderBluffScoreboard(players, containerId, withPodium = false, showActions = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = "";

    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);

    sortedPlayers.forEach((player, index) => {
        const row = document.createElement("tr");

        if (withPodium || containerId === "bluffScoreboardFinal") {
            if (index === 0) row.classList.add("rank-gold");
            if (index === 1) row.classList.add("rank-silver");
            if (index === 2) row.classList.add("rank-bronze");
        }

        if (containerId === "bluffScoreboardFinal") {
            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${buildBluffPlayerIdentity(player)}</td>
                <td>${player.score}</td>
                ${buildBluffRemoveActionCell(player.id, showActions)}
            `;
        } else {
            row.innerHTML = `
                <td>${buildBluffPlayerIdentity(player)}</td>
                <td>${player.score}</td>
                ${buildBluffRemoveActionCell(player.id, showActions)}
            `;
        }

        container.appendChild(row);
    });
}

function renderBluffTimer(elementId, deadlineAt) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (!deadlineAt) {
        el.textContent = "";
        return;
    }

    const now = Date.now() / 1000;
    const secondsLeft = Math.max(0, Math.ceil(deadlineAt - now));
    el.textContent = `${secondsLeft} ثانية`;
}

function updateBluffLiveTimer(data) {
    if (!data) return;

    if (data.phase === "submission") {
        renderBluffTimer("bluffTimerSubmission", data.phase_deadline_at);
    }

    if (data.phase === "answer_pick") {
        renderBluffTimer("bluffTimerAnswerPick", data.phase_deadline_at);
    }
}

function findMyPickFromRoomState(data) {
    if (!data?.picks || !currentBluffPlayerId) return null;
    return data.picks[currentBluffPlayerId] || null;
}

async function createBluffRoom() {
    const hostName = document.getElementById("bluffName").value.trim();
    const playerCount = selectedBluffPlayerCount;
    const totalRounds = selectedBluffRounds;

    if (!hostName) {
        showBluffError("\u0627\u0644\u0631\u062c\u0627\u0621 \u0625\u062f\u062e\u0627\u0644 \u0627\u0644\u0627\u0633\u0645 \u0623\u0648\u0644\u0627\u064b!");
        return;
    }

    if (!playerCount) {
        showBluffError("\u0627\u062e\u062a\u0631 \u0639\u062f\u062f \u0627\u0644\u0644\u0627\u0639\u0628\u064a\u0646 \u0623\u0648\u0644\u0627\u064b!");
        return;
    }

    if (!totalRounds) {
        showBluffError("\u0627\u062e\u062a\u0631 \u0639\u062f\u062f \u0627\u0644\u062c\u0648\u0644\u0627\u062a \u0623\u0648\u0644\u0627\u064b!");
        return;
    }

    if (totalRounds < playerCount) {
        showBluffError("\u0639\u062f\u062f \u0627\u0644\u062c\u0648\u0644\u0627\u062a \u064a\u062c\u0628 \u0623\u0646 \u064a\u0643\u0648\u0646 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644 \u0628\u0639\u062f\u062f \u0627\u0644\u0644\u0627\u0639\u0628\u064a\u0646.");
        return;
    }

    const response = await fetch("/api/bluff/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            host_name: hostName,
            character_id: selectedBluffCharacter,
            max_player_count: playerCount,
            total_rounds: totalRounds,
            categories: [],
            round_timer_seconds: selectedBluffRoundTimer
        })
    });

    const data = await response.json();

    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "\u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u063a\u0631\u0641\u0629."));
        return;
    }

    currentBluffRoomCode = data.room_code;
    currentBluffPlayerId = data.host_id;
    currentBluffPlayerName = hostName;
    currentBluffRoomData = data;
    bluffIsHost = true;
    selectedBluffCategories = [...(data.categories || [])];
    lastRenderedBluffSignature = null;

    localStorage.setItem("bluff_room_code", currentBluffRoomCode);
    localStorage.setItem("bluff_player_id", currentBluffPlayerId);
    localStorage.setItem("bluff_player_name", currentBluffPlayerName);

    hideBluffError();
    renderBluffWaitingRoom(data);
}

async function startBluffGame() {
    if ((currentBluffRoomData?.categories || []).length === 0) {
        showBluffError("\u0627\u062e\u062a\u0631 \u062a\u0635\u0646\u064a\u0641\u0627\u064b \u0648\u0627\u062d\u062f\u0627\u064b \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644 \u0642\u0628\u0644 \u0628\u062f\u0621 \u0627\u0644\u0644\u0639\u0628\u0629.");
        return;
    }

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/start`, {
        method: "POST"
    });

    const data = await response.json();

    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "\u062a\u0639\u0630\u0631 \u0628\u062f\u0621 \u0627\u0644\u0644\u0639\u0628\u0629."));
        return;
    }

    currentBluffRoomData = data;
    bluffIsHost = currentBluffPlayerId === data.host_id;
    lastRenderedBluffSignature = null;

    renderBluffState(data);
}

function renderBluffWaitingRoom(data) {
    hideAllBluffScreens();
    document.getElementById("screen-bluff-wait").classList.remove("hidden");

    currentBluffRoomData = data;
    selectedBluffCategories = [...(data.categories || [])];

    document.getElementById("bluffDisplayCode").textContent = data.room_code;
    renderBluffPregameCategories(data);
    renderBluffLobbyCharacterPicker(data);

    const actionsHeader = document.getElementById("bluffActionsHeader");
    const showLobbyActions = bluffIsHost || Boolean(window.appCurrentUser);
    if (actionsHeader) {
        actionsHeader.style.display = showLobbyActions ? "" : "none";
    }

    const playerList = document.getElementById("bluffPlayerList");
    playerList.innerHTML = "";

    [...data.players]
        .sort((a, b) => b.score - a.score)
        .forEach((player) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${buildBluffPlayerIdentity(player)}</td>
                <td>${player.score}</td>
                ${buildBluffLobbyActionCell(player)}
            `;
            playerList.appendChild(row);
        });

    const hostArea = document.getElementById("bluffHostArea");
    const memberArea = document.getElementById("bluffMemberArea");
    const startButton = document.querySelector("#bluffHostArea .btn-primary");

    if (startButton) {
        startButton.disabled = selectedBluffCategories.length === 0;
        startButton.classList.toggle("disabled", selectedBluffCategories.length === 0);
    }

    if (bluffIsHost) {
        hostArea.classList.remove("hidden");
        memberArea.classList.add("hidden");
    } else {
        hostArea.classList.add("hidden");
        memberArea.classList.remove("hidden");
    }
}

function resetBluffAndExit() {
    clearBluffLocalState();
    window.location.reload();
}

function clearBluffLocalState() {
    localStorage.removeItem("bluff_room_code");
    localStorage.removeItem("bluff_player_id");
    localStorage.removeItem("bluff_player_name");

    currentBluffRoomCode = null;
    currentBluffPlayerId = null;
    currentBluffPlayerName = null;
    currentBluffRoomData = null;
    bluffIsHost = false;
    lastRenderedBluffSignature = null;
    selectedBluffPlayerCount = null;
    selectedBluffRounds = null;
    selectedBluffCategories = [];
    localStorage.removeItem("bluff_character_id");
    selectedBluffCharacter = "char1";   
}

function hideAllBluffScreens() {
    const screens = [
        "screen-bluff-lobby",
        "screen-bluff-setup",
        "screen-bluff-wait",
        "screen-bluff-category-pick",
        "screen-bluff-submission",
        "screen-bluff-answer-pick",
        "screen-bluff-result",
        "screen-bluff-game-over"
    ];

    screens.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
    });
}

setInterval(async () => {
    if (currentBluffRoomCode && currentBluffPlayerId) {
        await refreshBluffRoomState();
    }
}, 3000);

setInterval(async () => {
    if (currentBluffRoomCode && currentBluffPlayerId) {
        try {
            await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/heartbeat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ player_id: currentBluffPlayerId })
            });
        } catch (e) {
            // Ignore errors
        }
    }
}, 10000);  // every 10 seconds

setInterval(() => {
    if (currentBluffRoomData) {
        updateBluffLiveTimer(currentBluffRoomData);
    }
}, 1000);

function ensureBluffInviteButton() {
    if (!window.appCurrentUser || !bluffIsHost || !currentBluffRoomCode) return;

    const hostArea = document.getElementById("bluffHostArea");
    if (!hostArea || hostArea.querySelector(".invite-friends-btn")) return;

    const inviteButton = document.createElement("button");
    inviteButton.type = "button";
    inviteButton.className = "btn invite-friends-btn";
    inviteButton.textContent = "دعوة الأصدقاء";
    inviteButton.onclick = () => openInviteFriendsModal("bluff", currentBluffRoomCode);
    hostArea.insertBefore(inviteButton, hostArea.firstChild);
}

const originalRenderBluffWaitingRoom = renderBluffWaitingRoom;
renderBluffWaitingRoom = function(data) {
    originalRenderBluffWaitingRoom(data);
    ensureBluffInviteButton();
};

async function maybeAutoJoinBluffInvite() {
    if (!window.appCurrentUser || currentBluffRoomCode || currentBluffPlayerId) return;

    const params = new URLSearchParams(window.location.search);
    const inviteRoom = params.get("invite_room");
    const accepted = params.get("invite_accept");
    if (!inviteRoom || accepted !== "1") return;

    const preferredName = (window.appCurrentUser.display_name || window.appCurrentUser.username || "").trim();
    if (preferredName) {
        currentBluffPlayerName = preferredName;
        localStorage.setItem("bluff_player_name", preferredName);
        const nameInput = document.getElementById("bluffName");
        if (nameInput) nameInput.value = preferredName;
    }

    const roomInput = document.getElementById("bluffRoomInput");
    if (roomInput) roomInput.value = inviteRoom;

    history.replaceState({}, "", location.pathname);
    await joinBluffRoom();
}

document.addEventListener("DOMContentLoaded", () => {
    maybeAutoJoinBluffInvite();
});

let bluffWS = null;
let bluffWSRoomCode = null;
let bluffWSShouldReconnect = false;
let bluffWSReconnectTimer = null;
let bluffActionCounter = 0;
let latestBluffRoomVersion = 0;
let bluffStaleResyncCount = 0;
const pendingBluffActions = new Map();

function nextBluffActionId() {
    bluffActionCounter += 1;
    return `bluff-action-${Date.now()}-${bluffActionCounter}`;
}

function sendBluffWSMessage(payload) {
    if (!bluffWS || bluffWS.readyState !== WebSocket.OPEN) return false;
    try {
        bluffWS.send(JSON.stringify(payload));
        return true;
    } catch (error) {
        console.error("Bluff WS send failed:", error);
        return false;
    }
}

function sendBluffWSAction(actionType, payload = {}) {
    if (!bluffWS || bluffWS.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("Realtime connection is not ready."));
    }

    const actionId = nextBluffActionId();
    const message = {
        type: actionType,
        action_id: actionId,
        player_id: currentBluffPlayerId,
        ...payload,
    };

    const timeoutId = setTimeout(() => {
        const pending = pendingBluffActions.get(actionId);
        if (!pending) return;
        pendingBluffActions.delete(actionId);
        pending.reject(new Error("Action timed out."));
    }, 8000);

    return new Promise((resolve, reject) => {
        pendingBluffActions.set(actionId, {
            resolve: () => {
                clearTimeout(timeoutId);
                resolve();
            },
            reject: (error) => {
                clearTimeout(timeoutId);
                reject(error);
            },
        });

        const sent = sendBluffWSMessage(message);
        if (!sent) {
            const pending = pendingBluffActions.get(actionId);
            if (pending) {
                pendingBluffActions.delete(actionId);
                pending.reject(new Error("Realtime connection is not ready."));
            }
        }
    });
}

function clearBluffWSReconnectTimer() {
    if (!bluffWSReconnectTimer) return;
    clearTimeout(bluffWSReconnectTimer);
    bluffWSReconnectTimer = null;
}

function scheduleBluffWSReconnect(roomCode) {
    if (!bluffWSShouldReconnect || !roomCode || !currentBluffPlayerId || bluffWSReconnectTimer) return;
    bluffWSReconnectTimer = setTimeout(() => {
        bluffWSReconnectTimer = null;
        if (!bluffWSShouldReconnect || currentBluffRoomCode !== roomCode || !currentBluffPlayerId) return;
        connectBluffWS(roomCode);
    }, 1500);
}

function closeBluffWS({ shouldReconnect = false } = {}) {
    bluffWSShouldReconnect = shouldReconnect;
    clearBluffWSReconnectTimer();

    if (!bluffWS) {
        bluffWSRoomCode = null;
        return;
    }

    const socket = bluffWS;
    bluffWS = null;
    bluffWSRoomCode = null;

    socket.onopen = null;
    socket.onerror = null;
    socket.onmessage = null;
    socket.onclose = null;

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        try {
            socket.close();
        } catch (error) {
            console.error("Bluff WS close failed:", error);
        }
    }
}

function applyBluffStateSync(state) {
    if (!state || typeof state !== "object") return;

    const incomingVersion = Number(state.room_version || 0);
    if (incomingVersion && incomingVersion < latestBluffRoomVersion) return;
    if (incomingVersion) latestBluffRoomVersion = incomingVersion;

    currentBluffRoomData = state;
    bluffIsHost = currentBluffPlayerId === state.host_id;

    if (!ensureCurrentBluffPlayerStillInRoom(state)) return;

    const signature = buildBluffStateSignature(state);
    if (signature === lastRenderedBluffSignature) {
        updateBluffLiveTimer(state);
        return;
    }

    lastRenderedBluffSignature = signature;
    renderBluffState(state);
}

function getBluffErrorMessage(data, fallbackMessage) {
    const detail = data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (detail && typeof detail === "object" && typeof detail.message === "string" && detail.message.trim()) {
        return detail.message;
    }
    return fallbackMessage;
}

function tryBluffStaleResync(response, data) {
    if (response?.status !== 409) return false;
    const staleState = data?.detail?.state;
    if (!staleState || typeof staleState !== "object") return false;
    bluffStaleResyncCount += 1;
    console.debug("[bluff] stale resync", {
        count: bluffStaleResyncCount,
        roomCode: currentBluffRoomCode,
        localVersion: latestBluffRoomVersion,
        serverVersion: Number(staleState.room_version || 0),
    });
    applyBluffStateSync(staleState);
    hideBluffError();
    return true;
}

function connectBluffWS(roomCode) {
    if (!roomCode || !currentBluffPlayerId) return;
    if (
        bluffWS &&
        bluffWSRoomCode === roomCode &&
        (bluffWS.readyState === WebSocket.OPEN || bluffWS.readyState === WebSocket.CONNECTING)
    ) {
        return;
    }

    closeBluffWS({ shouldReconnect: false });
    bluffWSShouldReconnect = true;
    clearBluffWSReconnectTimer();

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://${window.location.host}/api/bluff/ws/${roomCode}?player_id=${encodeURIComponent(currentBluffPlayerId)}`;

    let socket;
    try {
        socket = new WebSocket(wsUrl);
    } catch (error) {
        console.error("Bluff WS create failed:", error);
        scheduleBluffWSReconnect(roomCode);
        return;
    }

    bluffWS = socket;
    bluffWSRoomCode = roomCode;

    socket.onopen = () => {
        if (bluffWS !== socket) return;
        clearBluffWSReconnectTimer();
        sendBluffWSMessage({
            type: "sync_request",
            action_id: nextBluffActionId(),
            player_id: currentBluffPlayerId,
        });
    };

    socket.onmessage = (event) => {
        if (bluffWS !== socket) return;
        try {
            const data = JSON.parse(event.data);

            if (data.type === "state_sync" && data.state) {
                applyBluffStateSync(data.state);
                return;
            }

            if (data.type === "action_ack" && data.action_id) {
                const pending = pendingBluffActions.get(data.action_id);
                if (pending) {
                    pendingBluffActions.delete(data.action_id);
                    pending.resolve();
                }
                return;
            }

            if (data.type === "action_error") {
                if (data.action_id) {
                    const pending = pendingBluffActions.get(data.action_id);
                    if (pending) {
                        pendingBluffActions.delete(data.action_id);
                        pending.reject(new Error(data.detail || "Action failed."));
                    }
                }
                if (data.detail) showBluffError(data.detail);
            }
        } catch (error) {
            console.error("Bluff WS message error:", error);
        }
    };

    socket.onclose = () => {
        if (bluffWS === socket) {
            bluffWS = null;
            bluffWSRoomCode = null;
        }
        if (bluffWSShouldReconnect && currentBluffRoomCode === roomCode && currentBluffPlayerId) {
            scheduleBluffWSReconnect(roomCode);
        }
    };

    socket.onerror = (error) => {
        console.error("Bluff WS error:", error);
    };
}

const originalBluffCreateRoom = createBluffRoom;
createBluffRoom = async function() {
    await originalBluffCreateRoom();
    if (currentBluffRoomCode && currentBluffPlayerId) connectBluffWS(currentBluffRoomCode);
};

const originalBluffJoinRoom = joinBluffRoom;
joinBluffRoom = async function() {
    await originalBluffJoinRoom();
    if (currentBluffRoomCode && currentBluffPlayerId) connectBluffWS(currentBluffRoomCode);
};

const originalBluffUpdateCharacter = updateBluffLobbyCharacter;
updateBluffLobbyCharacter = async function(characterId) {
    if (currentBluffRoomCode && currentBluffPlayerId && bluffWS?.readyState === WebSocket.OPEN) {
        try {
            await sendBluffWSAction("update_character", { character_id: characterId });
            selectedBluffCharacter = characterId;
            localStorage.setItem("bluff_character_id", selectedBluffCharacter);
            return;
        } catch (error) {
            showBluffError(error.message || "Unable to update character.");
            return;
        }
    }
    await originalBluffUpdateCharacter(characterId);
};

toggleBluffCategory = async function(categoryKey) {
    if (!bluffIsHost || currentBluffRoomData?.started) return;

    const isSelected = selectedBluffCategories.includes(categoryKey);
    let nextCategories;

    if (isSelected) {
        nextCategories = selectedBluffCategories.filter((c) => c !== categoryKey);
    } else {
        if (selectedBluffCategories.length >= MAX_CATEGORIES) {
            showBluffError(`يمكنك اختيار ${MAX_CATEGORIES} تصنيفات كحد أقصى`);
            return;
        }
        nextCategories = [...selectedBluffCategories, categoryKey];
    }

    if (bluffWS?.readyState === WebSocket.OPEN) {
        try {
            await sendBluffWSAction("update_categories", { categories: nextCategories });
            return;
        } catch (error) {
            showBluffError(error.message || "تعذر تحديث التصنيفات.");
            return;
        }
    }

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            host_id: currentBluffPlayerId,
            categories: nextCategories
        })
    });
    const data = await response.json();
    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر تحديث التصنيفات."));
        return;
    }
    applyBluffStateSync(data);
};

startBluffGame = async function() {
    if ((currentBluffRoomData?.categories || []).length === 0) {
        showBluffError("اختر تصنيفًا واحدًا على الأقل قبل بدء اللعبة.");
        return;
    }
    if (bluffWS?.readyState === WebSocket.OPEN) {
        try {
            await sendBluffWSAction("start_game");
            return;
        } catch (error) {
            showBluffError(error.message || "تعذر بدء اللعبة.");
            return;
        }
    }
    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/start`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر بدء اللعبة."));
        return;
    }
    applyBluffStateSync(data);
};

selectBluffRoundCategory = async function(category) {
    if (bluffWS?.readyState === WebSocket.OPEN) {
        try {
            await sendBluffWSAction("select_category", { category });
            return;
        } catch (error) {
            showBluffError(error.message || "تعذر اختيار التصنيف.");
            return;
        }
    }
    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/select-category`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: currentBluffPlayerId, category })
    });
    const data = await response.json();
    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر اختيار التصنيف."));
        return;
    }
    applyBluffStateSync(data);
};

submitBluffAnswer = async function() {
    const input = document.getElementById("bluffAnswerInput");
    const answerText = input?.value?.trim() || "";
    if (!answerText) {
        showBluffError("اكتب إجابة أولًا.");
        return;
    }

    if (bluffWS?.readyState === WebSocket.OPEN) {
        try {
            await sendBluffWSAction("submit_answer", { answer_text: answerText });
            if (input) input.value = "";
            return;
        } catch (error) {
            showBluffError(error.message || "تعذر إرسال الإجابة.");
            return;
        }
    }

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/submit-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: currentBluffPlayerId, answer_text: answerText })
    });
    const data = await response.json();
    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر إرسال الإجابة."));
        return;
    }
    if (input) input.value = "";
    applyBluffStateSync(data);
};

submitBluffPick = async function(optionId) {
    if (bluffWS?.readyState === WebSocket.OPEN) {
        try {
            await sendBluffWSAction("submit_pick", { option_id: optionId });
            return;
        } catch (error) {
            showBluffError(error.message || "تعذر إرسال الاختيار.");
            return;
        }
    }

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/submit-pick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: currentBluffPlayerId, option_id: optionId })
    });
    const data = await response.json();
    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر إرسال الاختيار."));
        return;
    }
    applyBluffStateSync(data);
};

advanceBluffRound = async function() {
    if (bluffWS?.readyState === WebSocket.OPEN) {
        try {
            await sendBluffWSAction("advance_round");
            return;
        } catch (error) {
            showBluffError(error.message || "تعذر الانتقال للجولة التالية.");
            return;
        }
    }

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: currentBluffPlayerId })
    });
    const data = await response.json();
    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر الانتقال للجولة التالية."));
        return;
    }
    applyBluffStateSync(data);
};

restartBluffGame = async function() {
    const categories = selectedBluffCategories.length > 0
        ? selectedBluffCategories
        : currentBluffRoomData?.categories || [];
    if (categories.length === 0) {
        showBluffError("اختر تصنيفًا واحدًا على الأقل.");
        return;
    }

    const totalRounds = selectedBluffRounds || currentBluffRoomData?.total_rounds || categories.length;
    const roundTimer = selectedBluffRoundTimer || currentBluffRoomData?.round_timer_seconds || 30;

    if (bluffWS?.readyState === WebSocket.OPEN) {
        try {
            await sendBluffWSAction("restart_game", {
                categories,
                total_rounds: totalRounds,
                round_timer_seconds: roundTimer,
            });
            return;
        } catch (error) {
            showBluffError(error.message || "تعذر إعادة اللعبة.");
            return;
        }
    }

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            categories,
            total_rounds: totalRounds,
            round_timer_seconds: roundTimer,
        })
    });
    const data = await response.json();
    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر إعادة اللعبة."));
        return;
    }
    applyBluffStateSync(data);
};

removeBluffPlayer = async function(playerIdToRemove) {
    if (bluffWS?.readyState === WebSocket.OPEN) {
        try {
            await sendBluffWSAction("remove_player", { player_id_to_remove: playerIdToRemove });
            return;
        } catch (error) {
            showBluffError(error.message || "تعذر حذف اللاعب من الغرفة.");
            return;
        }
    }

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/remove-player`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            host_id: currentBluffPlayerId,
            player_id_to_remove: playerIdToRemove
        })
    });
    const data = await response.json();
    if (!response.ok) {
        if (tryBluffStaleResync(response, data)) return;
        showBluffError(getBluffErrorMessage(data, "تعذر حذف اللاعب من الغرفة."));
        return;
    }
    applyBluffStateSync(data);
};

const originalBluffLeaveRoom = leaveBluffRoom;
leaveBluffRoom = async function() {
    if (bluffWS?.readyState === WebSocket.OPEN) {
        try {
            await sendBluffWSAction("leave");
        } catch (error) {
            console.warn("Bluff WS leave failed, falling back to REST:", error);
        }
    }
    closeBluffWS({ shouldReconnect: false });
    await originalBluffLeaveRoom();
};

const originalClearBluffLocalState = clearBluffLocalState;
clearBluffLocalState = function() {
    closeBluffWS({ shouldReconnect: false });
    latestBluffRoomVersion = 0;
    originalClearBluffLocalState();
};

const originalRefreshBluffRoomState = refreshBluffRoomState;
refreshBluffRoomState = async function() {
    if (currentBluffRoomCode && currentBluffPlayerId) {
        connectBluffWS(currentBluffRoomCode);
    }
    if (bluffWS?.readyState === WebSocket.OPEN) return;
    await originalRefreshBluffRoomState();
};




