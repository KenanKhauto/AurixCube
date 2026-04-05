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
const MAX_CATEGORIES = 12;

const playerCountOptions = [3, 4, 5, 6, 7, 8, 9, 10];
const undercoverCountOptions = [1, 2, 3, 4];

const categoryLabels = {
    cars: "سيارات 🚗",
    countries: "دول 🌍",
    syrian_food: "أكلات سورية 🍲",
    football_players: "لاعبين كره قدم ⚽",
    football_teams: "فرق كره قدم 🏆",
    capitals: "عواصم 🏛️",
    syrian_series: "مسلسلات سورية 📺"
};

/**
 * Initialize page.
 */
document.addEventListener("DOMContentLoaded", async () => {
    renderPlayerCountButtons();
    renderUndercoverCountButtons();
    await loadCategories();

    if (currentPlayerName) {
        const nameInput = document.getElementById("pName");
        if (nameInput) {
            nameInput.value = currentPlayerName;
        }
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
            alert(`يمكنك اختيار ${MAX_CATEGORIES} تصنيفات كحد أقصى`);
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
        alert("الرجاء إدخال اسمك أولاً!");
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
        alert("الرجاء إدخال الاسم أولاً!");
        return;
    }

    if (!playerCount) {
        alert("اختر عدد اللاعبين أولاً!");
        return;
    }

    if (!undercoverCount) {
        alert("اختر عدد المندسين أولاً!");
        return;
    }

    if (selectedCategories.length === 0) {
        alert("اختر تصنيفاً واحداً على الأقل!");
        return;
    }
    const response = await fetch("/api/undercover/rooms", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            host_name: hostName,
            player_count: playerCount,
            undercover_count: undercoverCount,
            categories: selectedCategories
        })
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.detail || "حدث خطأ أثناء إنشاء الغرفة.");
        return;
    }

    const hostPlayer = data.players.find((player) => player.id === data.host_id);
    if (!hostPlayer) {
        alert("تعذر تحديد صاحب الغرفة.");
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
        alert("اكمل البيانات!");
        return;
    }

    const response = await fetch(`/api/undercover/rooms/${roomCode}/join`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ player_name: name })
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.detail || "تعذر الانضمام إلى الغرفة.");
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

    renderWaitingRoom(data);
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
        alert(data.detail || "تعذر بدء اللعبة.");
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
        alert(data.detail || "تعذر جلب الكلمة.");
        return;
    }

    cachedSecretWord = data.secret_word;

    switchScreen("screen-reveal");

    const wordBox = document.getElementById("mondasWord");
    wordBox.textContent = cachedSecretWord;
    wordBox.classList.add("blur");
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
        return;
    }

    const data = await response.json();
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
        alert("تعادل في التصويت. لم يُقصَ أحد. تابعوا النقاش وابدأوا جولة جديدة.");
        return;
    }

    if (data.last_vote_result === "eliminated") {
        const eliminated = data.players.find((p) => p.id === data.eliminated_player_id);
        if (!eliminated) return;

        if (data.eliminated_player_is_undercover) {
            alert(`تم إقصاء ${eliminated.name} وكان مندساً.`);
        } else {
            alert(`تم إقصاء ${eliminated.name} وكان بريئاً.`);
        }
    }
}

/**
 * Render waiting room.
 */
function renderWaitingRoom(data) {
    switchScreen("screen-wait");

    document.getElementById("displayCode").textContent = data.room_code;

    const playerList = document.getElementById("playerList");
    playerList.innerHTML = "";

    data.players.forEach((player) => {
        const badge = document.createElement("span");
        badge.style.background = "#333";
        badge.style.padding = "5px 10px";
        badge.style.borderRadius = "5px";
        badge.textContent = player.name;
        playerList.appendChild(badge);
    });

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
        deleteButton.textContent = "حذف الغرفة 🗑️";
        deleteButton.onclick = deleteCurrentRoom;
        playActions.appendChild(deleteButton);
    }

    renderVoters(data);
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
            alert(`يمكنك التصويت على ${maxVotes} لاعب فقط`);
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
        alert(data.detail || "تعذر إرسال التصويت.");
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
        alert(data.detail || "تعذر إعادة اللعبة.");
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
        alert(data.detail || "تعذر الخروج من الغرفة.");
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

    const confirmed = confirm("هل أنت متأكد أنك تريد حذف الغرفة بالكامل؟");
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
        alert(data.detail || "تعذر حذف الغرفة.");
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

    if (data.winner === "players") {
        finalMsg.textContent = "كفو! تم كشف جميع المندسين بنجاح ✅";
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