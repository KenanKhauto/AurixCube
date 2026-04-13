/**
 * Frontend logic for the Undercover game.
 *
 * FastAPI backend version.
 */

let currentRoomCode = localStorage.getItem("undercover_room_code") || null;
let currentPlayerId = localStorage.getItem("undercover_player_id") || null;
let currentPlayerName = localStorage.getItem("undercover_player_name") || null;
let currentRoomData = null;
let selectedVotes = [];
let cachedSecretWord = "";
let isHost = false;

let currentScreen = null;
let lastRenderedSignature = null;
let lastAnnouncementKey = null;

let selectedPlayerCount = null;
let selectedUndercoverCount = null;
let selectedCategories = [];
let allUndercoverCategories = [];
const MAX_CATEGORIES = 12;

const playerCountOptions = [3, 4, 5, 6, 7, 8, 9, 10];
const undercoverCountOptions = [1, 2, 3, 4];

const categoryLabels = {
    cars: "سيارات",
    countries: "دول",
    syrian_food: "أكلات سورية",
    football_players: "لاعبين كره قدم",
    football_teams: "فرق كره قدم",
    capitals: "عواصم",
    syrian_series: "مسلسلات سورية",
    prophets: "الأنبياء",
    syrian_characters: "شخصية من المسلسلات السورية",
    quran_references: "سور وآيات",
    video_games: "العاب فيديو",
    superheroes: "مارفل و دي سي",
    clothing_brands: "ماركات  ملابس",
};
function showUndercoverError(message) {
    const errorDiv = document.getElementById('undercover-global-error');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideUndercoverError() {
    const errorDiv = document.getElementById('undercover-global-error');
    errorDiv.classList.add('hidden');
}

async function handleUndercoverRoomExit(message) {
    clearLocalGameState();
    await openAppAlert(message, {
        title: "تمت إزالتك",
        confirmLabel: "الخروج",
        danger: true,
    });
    window.location.reload();
}

function ensureCurrentPlayerStillInRoom(data) {
    if ((data.players || []).some((player) => player.id === currentPlayerId)) {
        return true;
    }

    handleUndercoverRoomExit("تمت إزالتك من الغرفة.");
    return false;
}

function buildUndercoverRemoveButton(playerId) {
    if (!isHost || playerId === currentPlayerId) {
        return "";
    }

    return `<button class="btn-sm" onclick="removeUndercoverPlayer('${playerId}')">حذف</button>`;
}

function renderUndercoverPlayerList(containerId, data, includeVotes = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = "";

    data.players.forEach((player) => {
        const row = document.createElement("div");
        row.className = "vote-item" + (player.is_eliminated ? " eliminated" : "");

        const suffix = includeVotes ? ` (${getVotesReceived(data, player.id)})` : "";
        row.innerHTML = `
            <span>${player.name}${suffix}</span>
            ${buildUndercoverRemoveButton(player.id)}
        `;
        container.appendChild(row);
    });
}
/**
 * Initialize page.
 */
document.addEventListener("DOMContentLoaded", async () => {
    renderPlayerCountButtons();
    renderUndercoverCountButtons();
    await loadCategories();

    const nameInput = document.getElementById("pName");
    const defaultLobbyName = typeof getDefaultLobbyName === "function" ? getDefaultLobbyName() : "";
    const initialName = currentPlayerName || defaultLobbyName;
    if (nameInput && defaultLobbyName) {
        nameInput.placeholder = defaultLobbyName;
    }
    if (nameInput && initialName && !nameInput.value.trim()) {
        nameInput.value = initialName;
    }

    if (currentRoomCode) {
        const roomInput = document.getElementById("roomInput");
        if (roomInput) {
            roomInput.value = currentRoomCode;
        }
    }

    if (currentRoomCode && currentPlayerId) {
        await refreshRoomState();
    }
});

/**
 * Load categories from backend and fill the setup select.
 */
async function loadCategories() {
    const response = await fetch("/api/undercover/categories");
    const data = await response.json();

    const container = document.getElementById("mondasCategoryGrid");
    if (!container) return;

    container.innerHTML = "";

    Object.keys(data.categories).forEach((key) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.categoryKey = key;
        button.textContent = categoryLabels[key] || key;
        button.onclick = () => toggleCategory(key);

        container.appendChild(button);
    });

    updateCategoryButtonsState();
}

function toggleCategory(categoryKey) {
    const isSelected = selectedCategories.includes(categoryKey);

    if (isSelected) {
        selectedCategories = selectedCategories.filter((c) => c !== categoryKey);
    } else {
        if (selectedCategories.length >= MAX_CATEGORIES) {
            showUndercoverError(`يمكنك اختيار ${MAX_CATEGORIES} تصنيفات كحد أقصى`);
            return;
        }
        selectedCategories.push(categoryKey);
    }

    updateCategoryButtonsState();
}

function updateCategoryButtonsState() {
    const info = document.getElementById("categorySelectionInfo");
    if (info) {
        info.textContent = `تم اختيار ${selectedCategories.length} / ${MAX_CATEGORIES}`;
    }

    const buttons = document.querySelectorAll("#mondasCategoryGrid .category-btn");

    buttons.forEach((btn) => {
        const key = btn.dataset.categoryKey;
        const isSelected = selectedCategories.includes(key);

        if (isSelected) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }

        if (!isSelected && selectedCategories.length >= MAX_CATEGORIES) {
            btn.classList.add("disabled");
            btn.disabled = true;
        } else {
            btn.classList.remove("disabled");
            btn.disabled = false;
        }
    });
}


function renderPlayerCountButtons() {
    const container = document.getElementById("playerCountGrid");
    if (!container) return;

    container.innerHTML = "";

    playerCountOptions.forEach((count) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.playerCount = String(count);
        button.textContent = `${count} لاعبين`;
        button.onclick = () => {
            selectedPlayerCount = count;
            updatePlayerCountButtonsState();
        };

        container.appendChild(button);
    });

    updatePlayerCountButtonsState();
}

function updatePlayerCountButtonsState() {
    const buttons = document.querySelectorAll("#playerCountGrid .category-btn");

    buttons.forEach((btn) => {
        const count = Number(btn.dataset.playerCount);
        if (count === selectedPlayerCount) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}

function renderUndercoverCountButtons() {
    const container = document.getElementById("undercoverCountGrid");
    if (!container) return;

    container.innerHTML = "";

    undercoverCountOptions.forEach((count) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.undercoverCount = String(count);
        button.textContent = `${count} مندس`;
        button.onclick = () => {
            selectedUndercoverCount = count;
            updateUndercoverCountButtonsState();
        };

        container.appendChild(button);
    });

    updateUndercoverCountButtonsState();
}

function updateUndercoverCountButtonsState() {
    const buttons = document.querySelectorAll("#undercoverCountGrid .category-btn");

    buttons.forEach((btn) => {
        const count = Number(btn.dataset.undercoverCount);
        if (count === selectedUndercoverCount) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}


/**
 * Show game selection screen.
 */
function showSelection() {
    const name = document.getElementById("pName").value.trim();

    if (!name) {
        showUndercoverError("الرجاء إدخال اسمك أولاً!");
        return;
    }

    currentPlayerName = name;
    localStorage.setItem("undercover_player_name", currentPlayerName);

    switchScreen("screen-select");
}

/**
 * Return to lobby.
 */
function goBackToLobby() {
    switchScreen("screen-lobby");
}

/**
 * Show Undercover setup screen.
 */
function showMondasSetup() {
    switchScreen("screen-mondas-setup");
}

/**
 * Create a new room.
 */
async function createRoom() {
    const hostName = currentPlayerName || document.getElementById("pName").value.trim();
    const playerCount = selectedPlayerCount;
    const undercoverCount = selectedUndercoverCount;

    if (!hostName) {
        showUndercoverError("الرجاء إدخال الاسم أولاً!");
        return;
    }

    if (!playerCount) {
        showUndercoverError("اختر عدد اللاعبين أولاً!");
        return;
    }

    if (!undercoverCount) {
        showUndercoverError("اختر عدد المندسين أولاً!");
        return;
    }

    if (selectedCategories.length === 0) {
        showUndercoverError("اختر تصنيفاً واحداً على الأقل!");
        return;
    }
    const response = await fetch("/api/undercover/rooms", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            host_name: hostName,
            max_player_count: playerCount,
            undercover_count: undercoverCount,
            categories: selectedCategories
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showUndercoverError(data.detail || "حدث خطأ أثناء إنشاء الغرفة.");
        return;
    }

    const hostPlayer = data.players.find((player) => player.id === data.host_id);
    if (!hostPlayer) {
        showUndercoverError("تعذر تحديد صاحب الغرفة.");
        return;
    }

    currentRoomCode = data.room_code;
    currentPlayerId = data.host_id;
    currentPlayerName = hostName;
    currentRoomData = data;
    isHost = true;
    selectedVotes = [];
    cachedSecretWord = "";
    lastRenderedSignature = null;
    lastAnnouncementKey = null;

    localStorage.setItem("undercover_room_code", currentRoomCode);
    localStorage.setItem("undercover_player_id", currentPlayerId);
    localStorage.setItem("undercover_player_name", currentPlayerName);

    renderWaitingRoom(data);
}

/**
 * Join an existing room.
 */
async function joinRoom() {
    const name = document.getElementById("pName").value.trim();
    const roomCode = document.getElementById("roomInput").value.trim().toUpperCase();

    if (!name || !roomCode) {
        showUndercoverError("اكمل البيانات!");
        return;
    }

    const response = await fetch(`/api/undercover/rooms/${roomCode}/join`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ player_name: name })
    });

    const data = await response.json();

    if (!response.ok) {
        showUndercoverError(data.detail || "تعذر الانضمام إلى الغرفة.");
        return;
    }

    const joinedPlayer = data.players.find(
        (player) => player.name === name && player.id !== data.host_id
    ) || data.players[data.players.length - 1];

    currentRoomCode = roomCode;
    currentPlayerId = joinedPlayer.id;
    currentPlayerName = name;
    currentRoomData = data;
    isHost = currentPlayerId === data.host_id;
    selectedVotes = [];
    cachedSecretWord = "";
    lastRenderedSignature = null;
    lastAnnouncementKey = null;

    localStorage.setItem("undercover_room_code", currentRoomCode);
    localStorage.setItem("undercover_player_id", currentPlayerId);
    localStorage.setItem("undercover_player_name", currentPlayerName);

    renderState(data);
}

/**
 * Start the game.
 */
async function startMondasGame() {
    const response = await fetch(`/api/undercover/rooms/${currentRoomCode}/start`, {
        method: "POST"
    });

    const data = await response.json();

    if (!response.ok) {
        showUndercoverError(data.detail || "تعذر بدء اللعبة.");
        return;
    }

    currentRoomData = data;
    isHost = currentPlayerId === data.host_id;
    selectedVotes = [];
    lastRenderedSignature = null;
    lastAnnouncementKey = null;
    await showRevealScreen();
}

/**
 * Show personal secret word screen.
 */
async function showRevealScreen() {
    const response = await fetch(`/api/undercover/rooms/${currentRoomCode}/reveal`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ player_id: currentPlayerId })
    });

    const data = await response.json();

    if (!response.ok) {
        if (data.detail === "Player not found.") {
            await handleUndercoverRoomExit("تمت إزالتك من الغرفة.");
            return;
        }
        showUndercoverError(data.detail || "تعذر جلب الكلمة.");
        return;
    }

    cachedSecretWord = data.secret_word;

    switchScreen("screen-reveal");
    updateUndercoverRoomActionButtons();

    const wordBox = document.getElementById("mondasWord");
    wordBox.textContent = cachedSecretWord;
    wordBox.classList.add("blur");

    if (currentRoomData) {
        renderUndercoverPlayerList("revealPlayerList", currentRoomData);
    }
}

/**
 * Move from reveal screen to play screen.
 */
function moveToPlay() {
    if (!currentRoomData) return;
    renderPlayScreen(currentRoomData);
}

/**
 * Toggle hide/show word.
 */
function toggleRevealWord(element) {
    element.classList.toggle("blur");
}

/**
 * Refresh room state from backend.
 */
async function refreshRoomState() {
    if (!currentRoomCode) return;

    const response = await fetch(`/api/undercover/rooms/${currentRoomCode}`);

    if (!response.ok) {
        if (response.status === 404) {
            await handleUndercoverRoomExit("تم حذف الغرفة أو لم تعد متاحة.");
        }
        return;
    }

    const data = await response.json();
    if (!ensureCurrentPlayerStillInRoom(data)) return;

    currentRoomData = data;
    isHost = currentPlayerId === data.host_id;

    const stateSignature = buildStateSignature(data);

    if (data.ended) {
        if (currentScreen !== "screen-game-over" || lastRenderedSignature !== stateSignature) {
            renderGameOver(data);
            lastRenderedSignature = stateSignature;
        }
        return;
    }

    if (!data.started) {
        if (currentScreen !== "screen-wait" || lastRenderedSignature !== stateSignature) {
            renderWaitingRoom(data);
            lastRenderedSignature = stateSignature;
        }
        return;
    }

    if (!cachedSecretWord) {
        if (currentScreen !== "screen-reveal") {
            await showRevealScreen();
        }
        return;
    }

    if (currentScreen !== "screen-play" || lastRenderedSignature !== stateSignature) {
        renderPlayScreen(data);
        lastRenderedSignature = stateSignature;
    }

    announceRoundEventIfNeeded(data);
}

/**
 * Build a minimal signature so we only rerender when state meaningfully changed.
 */
function buildStateSignature(data) {
    const playersSignature = data.players
        .map((player) => `${player.id}:${player.is_eliminated ? 1 : 0}`)
        .join("|");

    const votesSignature = Object.entries(data.votes || {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([voterId, targets]) => `${voterId}:${targets.slice().sort().join(",")}`)
        .join("|");

    return JSON.stringify({
        started: data.started,
        ended: data.ended,
        winner: data.winner,
        round_number: data.round_number,
        current_asker_id: data.current_asker_id,
        current_target_id: data.current_target_id,
        eliminated_player_id: data.eliminated_player_id,
        eliminated_player_is_undercover: data.eliminated_player_is_undercover,
        last_vote_result: data.last_vote_result,
        players: playersSignature,
        votes: votesSignature
    });
}

/**
 * Show one announcement per round result.
 */
function announceRoundEventIfNeeded(data) {
    let eventKey = null;

    if (data.last_vote_result === "tie") {
        eventKey = `tie-round-${data.round_number}`;
    } else if (data.last_vote_result === "eliminated" && data.eliminated_player_id) {
        eventKey = `elim-${data.round_number}-${data.eliminated_player_id}`;
    }

    if (!eventKey || eventKey === lastAnnouncementKey) {
        return;
    }

    lastAnnouncementKey = eventKey;

    if (data.last_vote_result === "tie") {
        showUndercoverError("تعادل في التصويت. لم يُقصَ أحد. تابعوا النقاش وابدأوا جولة جديدة.");
        return;
    }

    if (data.last_vote_result === "eliminated") {
        const eliminated = data.players.find((p) => p.id === data.eliminated_player_id);
        if (!eliminated) return;

        if (data.eliminated_player_is_undercover) {
            showUndercoverError(`تم إقصاء ${eliminated.name} وكان مندساً.`);
        } else {
            showUndercoverError(`تم إقصاء ${eliminated.name} وكان بريئاً.`);
        }
    }
}

/**
 * Render waiting room.
 */
function renderWaitingRoom(data) {
    switchScreen("screen-wait");

    document.getElementById("displayCode").textContent = data.room_code;
    renderUndercoverPlayerList("playerList", data);

    const adminArea = document.getElementById("adminArea");
    const memberArea = document.getElementById("memberArea");
    const waitMsg = document.getElementById("waitMsg");

    if (isHost) {
        adminArea.classList.remove("hidden");
        memberArea.classList.add("hidden");
        waitMsg.classList.add("hidden");
    } else {
        adminArea.classList.add("hidden");
        memberArea.classList.remove("hidden");
        waitMsg.classList.remove("hidden");
    }
    updateUndercoverRoomActionButtons();
}

/**
 * Render play screen.
 */
function renderPlayScreen(data) {
    switchScreen("screen-play");

    const roundInfo = document.getElementById("roundInfo");
    roundInfo.textContent = `الجولة رقم ${data.round_number}`;

    const asker = data.players.find((player) => player.id === data.current_asker_id);
    const target = data.players.find((player) => player.id === data.current_target_id);

    const qBox = document.getElementById("qBox");
    if (asker && target) {
        qBox.textContent = `${target.name} اسأل ${asker.name}`;
    } else {
        qBox.textContent = "ابدأوا الأسئلة بين بعض بشكل حر، ثم صوّتوا على المندسين.";
    }

    const myWord = document.getElementById("myWordSmall");
    myWord.textContent = cachedSecretWord || "كلمتك";
    myWord.classList.add("blur");

    const playActions = document.getElementById("playActions");
    playActions.innerHTML = "";

    if (isHost) {
        const deleteButton = document.createElement("button");
        deleteButton.className = "btn";
        deleteButton.textContent = "حذف الغرفة";
        deleteButton.onclick = deleteCurrentRoom;
        playActions.appendChild(deleteButton);
    }

    renderVoters(data);
    updateUndercoverRoomActionButtons();
}

function updateUndercoverRoomActionButtons() {
    document.querySelectorAll(".room-leave-button").forEach((button) => {
        button.classList.toggle("hidden", isHost);
    });
    document.querySelectorAll(".room-delete-button").forEach((button) => {
        button.classList.toggle("hidden", !isHost);
    });
}

/**
 * Count how many votes a player currently has.
 */
function getVotesReceived(data, playerId) {
    let count = 0;

    Object.values(data.votes || {}).forEach((targets) => {
        if (targets.includes(playerId)) {
            count += 1;
        }
    });

    return count;
}

/**
 * Render players voting list.
 */
function renderVoters(data) {
    const container = document.getElementById("votersContainer");
    container.innerHTML = "<h4>صوّت للمندسين:</h4>";

    const backendVotes = data.votes[currentPlayerId] || [];
    if (selectedVotes.length === 0 && backendVotes.length > 0) {
        selectedVotes = [...backendVotes];
    }

    data.players.forEach((player) => {
        const div = document.createElement("div");
        div.className = "vote-item" + (player.is_eliminated ? " eliminated" : "");

        const isSelected = selectedVotes.includes(player.id);
        const votesReceived = getVotesReceived(data, player.id);

        let buttonHtml = "";
        if (!player.is_eliminated && player.id !== currentPlayerId) {
            buttonHtml = `
                <button class="btn-sm ${isSelected ? 'btn-primary' : ''}"
                        onclick="toggleVote('${player.id}', ${data.undercover_count})">
                    ${isSelected ? 'إلغاء' : 'تصويت'}
                </button>
            `;
        }

        div.innerHTML = `
            <span>${player.name} (${votesReceived})</span>
            ${buttonHtml}
            ${buildUndercoverRemoveButton(player.id)}
        `;

        container.appendChild(div);
    });

    const submitButton = document.createElement("button");
    submitButton.className = "btn btn-primary";

    const hasVoted = backendVotes.length > 0;

    // change text
    submitButton.textContent = hasVoted ? "تم التصويت" : "تأكيد التصويت";

    // disable if already voted
    submitButton.disabled = hasVoted;

    // apply style if already voted
    if (hasVoted) {
        submitButton.style.background = "#777";
        submitButton.style.cursor = "not-allowed";
        submitButton.style.opacity = "0.6";
    } else {
        submitButton.onclick = function () {
            submitVotes();
        };
    }

    container.appendChild(submitButton);
}

/**
 * Toggle vote selection locally before submit.
 */
function toggleVote(targetPlayerId, maxVotes) {
    if (selectedVotes.includes(targetPlayerId)) {
        selectedVotes = selectedVotes.filter((id) => id !== targetPlayerId);
    } else {
        if (selectedVotes.length >= maxVotes) {
            showUndercoverError(`يمكنك التصويت على ${maxVotes} لاعب فقط`);
            return;
        }
        selectedVotes.push(targetPlayerId);
    }

    if (currentRoomData) {
        renderVoters(currentRoomData);
    }
}

/**
 * Submit votes to backend.
 */
async function submitVotes() {
    const response = await fetch(`/api/undercover/rooms/${currentRoomCode}/vote`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            voter_id: currentPlayerId,
            voted_player_ids: selectedVotes
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showUndercoverError(data.detail || "تعذر إرسال التصويت.");
        return;
    }

    currentRoomData = data;
    isHost = currentPlayerId === data.host_id;
    selectedVotes = [];
    lastRenderedSignature = null;

    if (data.ended) {
        renderGameOver(data);
        announceRoundEventIfNeeded(data);
        return;
    }

    renderPlayScreen(data);
    announceRoundEventIfNeeded(data);
}

async function removeUndercoverPlayer(playerIdToRemove) {
    const confirmed = await openAppConfirm("هل أنت متأكد أنك تريد حذف هذا اللاعب من الغرفة؟", {
        title: "حذف لاعب",
        confirmLabel: "حذف اللاعب",
        cancelLabel: "إلغاء",
        danger: true,
    });
    if (!confirmed) return;

    const response = await fetch(`/api/undercover/rooms/${currentRoomCode}/remove-player`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            host_id: currentPlayerId,
            player_id_to_remove: playerIdToRemove
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showUndercoverError(data.detail || "تعذر حذف اللاعب.");
        return;
    }

    selectedVotes = selectedVotes.filter((playerId) => playerId !== playerIdToRemove);
    currentRoomData = data;
    isHost = currentPlayerId === data.host_id;
    lastRenderedSignature = null;

    if (data.ended) {
        renderGameOver(data);
        return;
    }

    if (!data.started) {
        renderWaitingRoom(data);
        return;
    }

    if (currentScreen === "screen-reveal") {
        renderUndercoverPlayerList("revealPlayerList", data);
        return;
    }

    renderPlayScreen(data);
}

/**
 * Restart current game with same players.
 */
async function restartGame() {
    const undercoverCount = selectedUndercoverCount;

    const response = await fetch(`/api/undercover/rooms/${currentRoomCode}/restart`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            categories: selectedCategories,
            undercover_count: undercoverCount
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showUndercoverError(data.detail || "تعذر إعادة اللعبة.");
        return;
    }

    cachedSecretWord = "";
    selectedVotes = [];
    currentRoomData = data;
    isHost = currentPlayerId === data.host_id;
    lastRenderedSignature = null;
    lastAnnouncementKey = null;
    renderWaitingRoom(data);
}

/**
 * Leave current room as non-host before game starts.
 */
async function leaveCurrentRoom() {
    if (!currentRoomCode || !currentPlayerId) return;

    const confirmed = confirm("هل أنت متأكد أنك تريد الخروج من الغرفة؟");
    if (!confirmed) return;

    const response = await fetch(`/api/undercover/rooms/${currentRoomCode}/leave`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            player_id: currentPlayerId
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showUndercoverError(data.detail || "تعذر الخروج من الغرفة.");
        return;
    }

    clearLocalGameState();
    goBackToLobby();
}

/**
 * Delete current room as host.
 */
async function deleteCurrentRoom() {
    if (!currentRoomCode || !currentPlayerId) return;

    const confirmed = await openAppConfirm("هل أنت متأكد أنك تريد حذف الغرفة بالكامل؟", {
        title: "حذف الغرفة",
        confirmLabel: "حذف الغرفة",
        cancelLabel: "إلغاء",
        danger: true,
    });
    if (!confirmed) return;

    const response = await fetch(`/api/undercover/rooms/${currentRoomCode}/delete`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            player_id: currentPlayerId
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showUndercoverError(data.detail || "تعذر حذف الغرفة.");
        return;
    }

    clearLocalGameState();
    goBackToLobby();
}

/**
 * Render final screen.
 */
function renderGameOver(data) {
    switchScreen("screen-game-over");

    const finalMsg = document.getElementById("final-msg");

    // Handle insufficient players
    if (data.end_reason === "insufficient_players") {
        finalMsg.textContent = "انتهت اللعبة! عدد اللاعبين غير كافي للمتابعة.";
    } else if (data.winner === "players") {
        finalMsg.textContent = "كفو! تم كشف جميع المندسين بنجاح";
    } else {
        finalMsg.textContent = "انتهت اللعبة! أصبح عدد المندسين مساوياً أو أكبر من الأبرياء.";
    }

    const replayArea = document.getElementById("adminReplayArea");
    const memberArea = document.getElementById("memberGameOverArea");

    if (isHost) {
        replayArea.classList.remove("hidden");
        memberArea.classList.add("hidden");
    } else {
        replayArea.classList.add("hidden");
        memberArea.classList.remove("hidden");
    }

    renderUndercoverPlayerList("gameOverPlayerList", data);
}

async function loadCategories() {
    const response = await fetch("/api/undercover/categories");
    const data = await response.json();
    allUndercoverCategories = Object.keys(data.categories || {});
}

async function toggleCategory(categoryKey) {
    if (!isHost || currentRoomData?.started) {
        return;
    }

    const isSelected = selectedCategories.includes(categoryKey);
    let nextCategories;

    if (isSelected) {
        nextCategories = selectedCategories.filter((c) => c !== categoryKey);
    } else {
        if (selectedCategories.length >= MAX_CATEGORIES) {
            showUndercoverError(`يمكنك اختيار ${MAX_CATEGORIES} تصنيفات كحد أقصى`);
            return;
        }
        nextCategories = [...selectedCategories, categoryKey];
    }

    const response = await fetch(`/api/undercover/rooms/${currentRoomCode}/categories`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            host_id: currentPlayerId,
            categories: nextCategories
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showUndercoverError(data.detail || "تعذر تحديث التصنيفات.");
        return;
    }

    currentRoomData = data;
    selectedCategories = [...(data.categories || [])];
    isHost = currentPlayerId === data.host_id;
    lastRenderedSignature = null;
    renderWaitingRoom(data);
}

function updateCategoryButtonsState() {
    const info = document.getElementById("categorySelectionInfo");
    const canEdit = isHost && currentRoomData && !currentRoomData.started;
    if (info) {
        info.textContent = `تم اختيار ${selectedCategories.length} / ${MAX_CATEGORIES}`;
    }

    const buttons = document.querySelectorAll("#mondasCategoryGrid .category-btn");

    buttons.forEach((btn) => {
        const key = btn.dataset.categoryKey;
        const isSelected = selectedCategories.includes(key);

        btn.classList.toggle("active", isSelected);

        if (!canEdit) {
            btn.classList.add("disabled");
            btn.disabled = true;
            return;
        }

        if (!isSelected && selectedCategories.length >= MAX_CATEGORIES) {
            btn.classList.add("disabled");
            btn.disabled = true;
        } else {
            btn.classList.remove("disabled");
            btn.disabled = false;
        }
    });
}

function renderUndercoverPregameCategories(data) {
    const container = document.getElementById("mondasCategoryGrid");
    if (!container) return;

    container.innerHTML = "";

    allUndercoverCategories.forEach((key) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.categoryKey = key;
        button.textContent = categoryLabels[key] || key;
        button.onclick = () => toggleCategory(key);
        container.appendChild(button);
    });

    const info = document.getElementById("categorySelectionInfo");
    if (info && !isHost) {
        info.textContent = data.categories?.length
            ? `المنظم يختار التصنيفات الآن: ${data.categories.length} / ${MAX_CATEGORIES}`
            : `المنظم لم يختر أي تصنيف بعد`;
    }

    updateCategoryButtonsState();
}

async function createRoom() {
    const hostName = currentPlayerName || document.getElementById("pName").value.trim();
    const playerCount = selectedPlayerCount;
    const undercoverCount = selectedUndercoverCount;

    if (!hostName) {
        showUndercoverError("الرجاء إدخال الاسم أولاً!");
        return;
    }

    if (!playerCount) {
        showUndercoverError("اختر عدد اللاعبين أولاً!");
        return;
    }

    if (!undercoverCount) {
        showUndercoverError("اختر عدد المندسين أولاً!");
        return;
    }

    const response = await fetch("/api/undercover/rooms", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            host_name: hostName,
            max_player_count: playerCount,
            undercover_count: undercoverCount,
            categories: []
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showUndercoverError(data.detail || "حدث خطأ أثناء إنشاء الغرفة.");
        return;
    }

    const hostPlayer = data.players.find((player) => player.id === data.host_id);
    if (!hostPlayer) {
        showUndercoverError("تعذر تحديد صاحب الغرفة.");
        return;
    }

    currentRoomCode = data.room_code;
    currentPlayerId = data.host_id;
    currentPlayerName = hostName;
    currentRoomData = data;
    isHost = true;
    selectedVotes = [];
    cachedSecretWord = "";
    selectedCategories = [...(data.categories || [])];
    lastRenderedSignature = null;
    lastAnnouncementKey = null;

    localStorage.setItem("undercover_room_code", currentRoomCode);
    localStorage.setItem("undercover_player_id", currentPlayerId);
    localStorage.setItem("undercover_player_name", currentPlayerName);

    renderWaitingRoom(data);
}

async function startMondasGame() {
    if (!currentRoomData?.categories?.length) {
        showUndercoverError("اختر تصنيفًا واحدًا على الأقل قبل بدء اللعبة.");
        return;
    }

    const response = await fetch(`/api/undercover/rooms/${currentRoomCode}/start`, {
        method: "POST"
    });

    const data = await response.json();

    if (!response.ok) {
        showUndercoverError(data.detail || "تعذر بدء اللعبة.");
        return;
    }

    currentRoomData = data;
    isHost = currentPlayerId === data.host_id;
    selectedVotes = [];
    lastRenderedSignature = null;
    lastAnnouncementKey = null;
    await showRevealScreen();
}

function buildStateSignature(data) {
    const playersSignature = data.players
        .map((player) => `${player.id}:${player.is_eliminated ? 1 : 0}`)
        .join("|");

    const votesSignature = Object.entries(data.votes || {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([voterId, targets]) => `${voterId}:${targets.slice().sort().join(",")}`)
        .join("|");

    return JSON.stringify({
        started: data.started,
        ended: data.ended,
        winner: data.winner,
        round_number: data.round_number,
        current_asker_id: data.current_asker_id,
        current_target_id: data.current_target_id,
        eliminated_player_id: data.eliminated_player_id,
        eliminated_player_is_undercover: data.eliminated_player_is_undercover,
        last_vote_result: data.last_vote_result,
        categories: (data.categories || []).join(","),
        players: playersSignature,
        votes: votesSignature
    });
}

function renderWaitingRoom(data) {
    switchScreen("screen-wait");
    currentRoomData = data;
    selectedCategories = [...(data.categories || [])];

    document.getElementById("displayCode").textContent = data.room_code;
    renderUndercoverPlayerList("playerList", data);
    renderUndercoverPregameCategories(data);

    const adminArea = document.getElementById("adminArea");
    const memberArea = document.getElementById("memberArea");
    const waitMsg = document.getElementById("waitMsg");

    if (isHost) {
        adminArea.classList.remove("hidden");
        memberArea.classList.add("hidden");
        waitMsg.classList.add("hidden");
    } else {
        adminArea.classList.add("hidden");
        memberArea.classList.remove("hidden");
        waitMsg.classList.remove("hidden");
    }
    updateUndercoverRoomActionButtons();
}

async function restartGame() {
    const undercoverCount = selectedUndercoverCount || currentRoomData?.undercover_count;
    const categories = selectedCategories.length > 0
        ? selectedCategories
        : currentRoomData?.categories || [];

    const response = await fetch(`/api/undercover/rooms/${currentRoomCode}/restart`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            categories,
            undercover_count: undercoverCount
        })
    });

    const data = await response.json();

    if (!response.ok) {
        showUndercoverError(data.detail || "تعذر إعادة اللعبة.");
        return;
    }

    cachedSecretWord = "";
    selectedVotes = [];
    currentRoomData = data;
    isHost = currentPlayerId === data.host_id;
    selectedCategories = [...(data.categories || [])];
    lastRenderedSignature = null;
    lastAnnouncementKey = null;
    renderWaitingRoom(data);
}

/**
 * Reset local state and go back to start.
 */
function resetAndExit() {
    clearLocalGameState();
    window.location.reload();
}

/**
 * Clear local room/player state.
 */
function clearLocalGameState() {
    localStorage.removeItem("undercover_room_code");
    localStorage.removeItem("undercover_player_id");
    localStorage.removeItem("undercover_player_name");

    currentRoomCode = null;
    currentPlayerId = null;
    currentPlayerName = null;
    currentRoomData = null;
    selectedVotes = [];
    cachedSecretWord = "";
    isHost = false;
    currentScreen = null;
    lastRenderedSignature = null;
    lastAnnouncementKey = null;
    selectedPlayerCount = null;
    selectedUndercoverCount = null;
    selectedCategories = [];
}

/**
 * Hide all screens.
 */
function hideAll() {
    document.querySelectorAll(".card").forEach((card) => card.classList.add("hidden"));
}

/**
 * Switch visible screen only if needed.
 */
function switchScreen(screenId) {
    if (currentScreen === screenId) {
        return;
    }

    hideAll();
    const target = document.getElementById(screenId);
    if (target) {
        target.classList.remove("hidden");
        currentScreen = screenId;
    }
}

/**
 * Poll room state every few seconds.
 */
setInterval(async () => {
    if (currentRoomCode && currentPlayerId) {
        await refreshRoomState();
    }
}, 3000);

setInterval(async () => {
    if (currentRoomCode && currentPlayerId) {
        try {
            await fetch(`/api/undercover/rooms/${currentRoomCode}/heartbeat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ player_id: currentPlayerId })
            });
        } catch (e) {
            // Ignore errors
        }
    }
}, 10000);

function ensureUndercoverInviteButton() {
    if (!window.appCurrentUser || !isHost || !currentRoomCode) return;

    const hostArea = document.getElementById("adminArea");
    if (!hostArea || hostArea.querySelector(".invite-friends-btn")) return;

    const inviteButton = document.createElement("button");
    inviteButton.type = "button";
    inviteButton.className = "btn invite-friends-btn";
    inviteButton.textContent = "دعوة الأصدقاء";
    inviteButton.onclick = () => openInviteFriendsModal("undercover", currentRoomCode);
    hostArea.insertBefore(inviteButton, hostArea.firstChild);
}

const originalUndercoverRenderWaitingRoom = renderWaitingRoom;
renderWaitingRoom = function(data) {
    originalUndercoverRenderWaitingRoom(data);
    ensureUndercoverInviteButton();
};

async function maybeAutoJoinUndercoverInvite() {
    if (!window.appCurrentUser || currentRoomCode || currentPlayerId) return;

    const params = new URLSearchParams(window.location.search);
    const inviteRoom = params.get("invite_room");
    const accepted = params.get("invite_accept");
    if (!inviteRoom || accepted !== "1") return;

    const preferredName = (window.appCurrentUser.display_name || window.appCurrentUser.username || "").trim();
    if (preferredName) {
        currentPlayerName = preferredName;
        localStorage.setItem("undercover_player_name", preferredName);
        const nameInput = document.getElementById("pName");
        if (nameInput) nameInput.value = preferredName;
    }

    const roomInput = document.getElementById("roomInput");
    if (roomInput) roomInput.value = inviteRoom;

    history.replaceState({}, "", location.pathname);
    await joinRoom();
}

document.addEventListener("DOMContentLoaded", () => {
    maybeAutoJoinUndercoverInvite();
});
