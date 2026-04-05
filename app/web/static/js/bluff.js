/**
 * Frontend logic for the Bluff game.
 *
 * This version uses the FastAPI backend and supports:
 * - room creation / joining
 * - host deletion of room
 * - non-host leaving room before game starts
 * - round-based bluff submission
 * - voting on the correct answer
 * - scoreboards and round results
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
const MAX_CATEGORIES = 12;

const bluffPlayerCountOptions = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const bluffRoundsOptions = [1, 3, 5, 7, 10];

const bluffCategoryLabels = {
    capitals: "عواصم 🌍",
    football: "كرة قدم ⚽",
    syrian_food: "أكلات سورية 🍲",
    general: "معلومات عامة 🧠",
    strange_facts: "معلومات غريبة"
};

/**
 * Initialize page.
 */
document.addEventListener("DOMContentLoaded", async () => {
    renderBluffPlayerCountButtons();
    renderBluffRoundsButtons();
    await loadBluffCategories();

    if (currentBluffPlayerName) {
        const nameInput = document.getElementById("bluffName");
        if (nameInput) {
            nameInput.value = currentBluffPlayerName;
        }
    }

    if (currentBluffRoomCode) {
        const roomInput = document.getElementById("bluffRoomInput");
        if (roomInput) {
            roomInput.value = currentBluffRoomCode;
        }
    }

    if (currentBluffRoomCode && currentBluffPlayerId) {
        await refreshBluffRoomState();
    }
});

/**
 * Load categories from backend and fill setup select.
 */
async function loadBluffCategories() {
    const response = await fetch("/api/bluff/categories");
    const data = await response.json();

    const container = document.getElementById("bluffCategoryGrid");
    if (!container) return;

    container.innerHTML = "";

    Object.keys(data.categories).forEach((key) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.categoryKey = key;
        button.textContent = bluffCategoryLabels[key] || key;
        button.onclick = () => toggleBluffCategory(key);

        container.appendChild(button);
    });

    updateBluffCategoryButtonsState();
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
        button.onclick = () => selectBluffPlayerCount(count);

        container.appendChild(button);
    });

    updateBluffPlayerCountButtonsState();
}

function selectBluffPlayerCount(count) {
    selectedBluffPlayerCount = count;
    updateBluffPlayerCountButtonsState();
}

function updateBluffPlayerCountButtonsState() {
    const buttons = document.querySelectorAll("#bluffPlayerCountGrid .category-btn");

    buttons.forEach((btn) => {
        const count = Number(btn.dataset.playerCount);

        if (count === selectedBluffPlayerCount) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}

function renderBluffRoundsButtons() {
    const container = document.getElementById("bluffRoundsGrid");
    if (!container) return;

    container.innerHTML = "";

    bluffRoundsOptions.forEach((rounds) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-btn";
        button.dataset.rounds = String(rounds);
        button.textContent = `${rounds} جولات`;
        button.onclick = () => selectBluffRounds(rounds);

        container.appendChild(button);
    });

    updateBluffRoundsButtonsState();
}

function selectBluffRounds(rounds) {
    selectedBluffRounds = rounds;
    updateBluffRoundsButtonsState();
}

function updateBluffRoundsButtonsState() {
    const buttons = document.querySelectorAll("#bluffRoundsGrid .category-btn");

    buttons.forEach((btn) => {
        const rounds = Number(btn.dataset.rounds);

        if (rounds === selectedBluffRounds) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}

function toggleBluffCategory(categoryKey) {
    const isSelected = selectedBluffCategories.includes(categoryKey);

    if (isSelected) {
        selectedBluffCategories = selectedBluffCategories.filter((c) => c !== categoryKey);
    } else {
        if (selectedBluffCategories.length >= MAX_CATEGORIES) {
            alert(`يمكنك اختيار ${MAX_CATEGORIES} تصنيفات كحد أقصى`);
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

        if (isSelected) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }

        if (!isSelected && selectedBluffCategories.length >= MAX_CATEGORIES) {
            btn.classList.add("disabled");
            btn.disabled = true;
        } else {
            btn.classList.remove("disabled");
            btn.disabled = false;
        }
    });
}


/**
 * Show bluff setup screen.
 */
function showBluffSetup() {
    const name = document.getElementById("bluffName").value.trim();

    if (!name) {
        alert("الرجاء إدخال اسمك أولاً!");
        return;
    }

    currentBluffPlayerName = name;
    localStorage.setItem("bluff_player_name", currentBluffPlayerName);

    hideAllBluffScreens();
    document.getElementById("screen-bluff-setup").classList.remove("hidden");
}

/**
 * Return to bluff lobby.
 */
function goBackToBluffLobby() {
    hideAllBluffScreens();
    document.getElementById("screen-bluff-lobby").classList.remove("hidden");
}

/**
 * Create a new bluff room.
 */
async function createBluffRoom() {
    const hostName = document.getElementById("bluffName").value.trim();
    const playerCount = selectedBluffPlayerCount;
    const totalRounds = selectedBluffRounds;

    if (!hostName) {
        alert("الرجاء إدخال الاسم أولاً!");
        return;
    }

    if (!playerCount) {
        alert("اختر عدد اللاعبين أولاً!");
        return;
    }

    if (!totalRounds) {
        alert("اختر عدد الجولات أولاً!");
        return;
    }

    if (selectedBluffCategories.length === 0) {
        alert("اختر تصنيفاً واحداً على الأقل!");
        return;
    }


    const response = await fetch("/api/bluff/rooms", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            host_name: hostName,
            player_count: playerCount,
            total_rounds: totalRounds,
            categories: selectedBluffCategories
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

    currentBluffRoomCode = data.room_code;
    currentBluffPlayerId = data.host_id;
    currentBluffPlayerName = hostName;
    currentBluffRoomData = data;
    bluffIsHost = true;
    lastRenderedBluffSignature = null;

    localStorage.setItem("bluff_room_code", currentBluffRoomCode);
    localStorage.setItem("bluff_player_id", currentBluffPlayerId);
    localStorage.setItem("bluff_player_name", currentBluffPlayerName);

    renderBluffWaitingRoom(data);
}

/**
 * Join an existing bluff room.
 */
async function joinBluffRoom() {
    const name = document.getElementById("bluffName").value.trim();
    const roomCode = document.getElementById("bluffRoomInput").value.trim().toUpperCase();

    if (!name || !roomCode) {
        alert("اكمل البيانات!");
        return;
    }

    const response = await fetch(`/api/bluff/rooms/${roomCode}/join`, {
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

    currentBluffRoomCode = roomCode;
    currentBluffPlayerId = joinedPlayer.id;
    currentBluffPlayerName = name;
    currentBluffRoomData = data;
    bluffIsHost = currentBluffPlayerId === data.host_id;
    lastRenderedBluffSignature = null;

    localStorage.setItem("bluff_room_code", currentBluffRoomCode);
    localStorage.setItem("bluff_player_id", currentBluffPlayerId);
    localStorage.setItem("bluff_player_name", currentBluffPlayerName);

    renderBluffWaitingRoom(data);
}

/**
 * Start the bluff game.
 */
async function startBluffGame() {
    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/start`, {
        method: "POST"
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.detail || "تعذر بدء اللعبة.");
        return;
    }

    currentBluffRoomData = data;
    bluffIsHost = currentBluffPlayerId === data.host_id;
    lastRenderedBluffSignature = null;

    renderBluffState(data);
}

/**
 * Submit bluff answer.
 */
async function submitBluffAnswer() {
    const input = document.getElementById("bluffAnswerInput");
    const answerText = input.value.trim();

    if (!answerText) {
        alert("اكتب إجابة أولاً.");
        return;
    }

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/submit-answer`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            player_id: currentBluffPlayerId,
            answer_text: answerText
        })
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.detail || "تعذر إرسال الإجابة.");
        return;
    }

    currentBluffRoomData = data;
    bluffIsHost = currentBluffPlayerId === data.host_id;
    lastRenderedBluffSignature = null;

    input.value = "";
    renderBluffState(data);
}

/**
 * Submit vote for one option.
 */
async function submitBluffVote(optionId) {
    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/vote`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            player_id: currentBluffPlayerId,
            option_id: optionId
        })
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.detail || "تعذر إرسال التصويت.");
        return;
    }

    currentBluffRoomData = data;
    bluffIsHost = currentBluffPlayerId === data.host_id;
    lastRenderedBluffSignature = null;

    renderBluffState(data);
}

/**
 * Advance to next round (host only).
 */
async function advanceBluffRound() {
    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/advance`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            player_id: currentBluffPlayerId
        })
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.detail || "تعذر الانتقال للجولة التالية.");
        return;
    }

    currentBluffRoomData = data;
    bluffIsHost = currentBluffPlayerId === data.host_id;
    lastRenderedBluffSignature = null;

    renderBluffState(data);
}

/**
 * Restart bluff game with same players.
 */
async function restartBluffGame() {
    const totalRounds = selectedBluffRounds;

    if (!totalRounds) {
        alert("اختر عدد الجولات أولاً!");
        return;
    }

    if (selectedBluffCategories.length === 0) {
        alert("اختر تصنيفاً واحداً على الأقل!");
        return;
    }

    

    const response = await fetch(`/api/bluff/rooms/${bluffRoomCode}/restart`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            categories: selectedBluffCategories,
            total_rounds: totalRounds
        })
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.detail || "تعذر إعادة اللعبة.");
        return;
    }

    bluffRoomData = data;
    bluffIsHost = bluffPlayerId === data.host_id;
    bluffLastSignature = null;
    renderBluffWaitingRoom(data);
}

/**
 * Leave current room as non-host before game starts.
 */
async function leaveBluffRoom() {
    if (!currentBluffRoomCode || !currentBluffPlayerId) return;

    const confirmed = confirm("هل أنت متأكد أنك تريد الخروج من الغرفة؟");
    if (!confirmed) return;

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/leave`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            player_id: currentBluffPlayerId
        })
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.detail || "تعذر الخروج من الغرفة.");
        return;
    }

    clearBluffLocalState();
    window.location.reload();
}

/**
 * Delete current room as host.
 */
async function deleteBluffRoom() {
    if (!currentBluffRoomCode || !currentBluffPlayerId) return;

    const confirmed = confirm("هل أنت متأكد أنك تريد حذف الغرفة بالكامل؟");
    if (!confirmed) return;

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/delete`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            player_id: currentBluffPlayerId
        })
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.detail || "تعذر حذف الغرفة.");
        return;
    }

    clearBluffLocalState();
    window.location.reload();
}

/**
 * Refresh room state from backend.
 */
async function refreshBluffRoomState() {
    if (!currentBluffRoomCode) return;

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}`);

    if (!response.ok) {
        return;
    }

    const data = await response.json();
    currentBluffRoomData = data;
    bluffIsHost = currentBluffPlayerId === data.host_id;

    const signature = buildBluffStateSignature(data);
    if (signature === lastRenderedBluffSignature) {
        return;
    }

    lastRenderedBluffSignature = signature;
    renderBluffState(data);
}

/**
 * Render current bluff state based on phase.
 */
function renderBluffState(data) {
    if (data.ended || data.phase === "game_over") {
        renderBluffGameOver(data);
        return;
    }

    if (!data.started || data.phase === "waiting") {
        renderBluffWaitingRoom(data);
        return;
    }

    if (data.phase === "writing") {
        renderBluffWritingPhase(data);
        return;
    }

    if (data.phase === "voting") {
        renderBluffVotingPhase(data);
        return;
    }

    if (data.phase === "round_result") {
        renderBluffRoundResult(data);
    }
}

/**
 * Build a lightweight signature to avoid pointless rerenders.
 */
function buildBluffStateSignature(data) {
    const playersSignature = data.players
        .map((player) => `${player.id}:${player.score}`)
        .join("|");

    const optionsSignature = (data.answer_options || [])
        .map((option) => `${option.id}:${option.votes_received}`)
        .join("|");

    return JSON.stringify({
        started: data.started,
        ended: data.ended,
        phase: data.phase,
        current_round: data.current_round,
        submissions_count: data.submissions_count,
        votes_count: data.votes_count,
        last_round_message: data.last_round_message,
        last_round_correct_option_id: data.last_round_correct_option_id,
        winner_ids: data.winner_ids,
        players: playersSignature,
        options: optionsSignature
    });
}

/**
 * Render waiting room.
 */
function renderBluffWaitingRoom(data) {
    hideAllBluffScreens();
    document.getElementById("screen-bluff-wait").classList.remove("hidden");

    document.getElementById("bluffDisplayCode").textContent = data.room_code;

    const playerList = document.getElementById("bluffPlayerList");
    playerList.innerHTML = "";

    data.players.forEach((player) => {
        const badge = document.createElement("span");
        badge.style.background = "#333";
        badge.style.padding = "5px 10px";
        badge.style.borderRadius = "5px";
        badge.textContent = `${player.name} (${player.score})`;
        playerList.appendChild(badge);
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

/**
 * Render writing phase.
 */
function renderBluffWritingPhase(data) {
    hideAllBluffScreens();
    document.getElementById("screen-bluff-writing").classList.remove("hidden");

    document.getElementById("bluffRoundInfo").textContent =
        `الجولة ${data.current_round} / ${data.total_rounds}`;

    document.getElementById("bluffQuestionBox").textContent = data.current_question;

    document.getElementById("bluffSubmissionsInfo").textContent =
        `تم إرسال ${data.submissions_count} من ${data.players.length}`;

    renderBluffScoreboard(data.players, "bluffScoreboardWriting");
}

/**
 * Render voting phase.
 */
function renderBluffVotingPhase(data) {
    hideAllBluffScreens();
    document.getElementById("screen-bluff-voting").classList.remove("hidden");

    document.getElementById("bluffRoundInfoVoting").textContent =
        `الجولة ${data.current_round} / ${data.total_rounds}`;

    document.getElementById("bluffQuestionBoxVoting").textContent = data.current_question;

    document.getElementById("bluffVotesInfo").textContent =
        `تم التصويت من ${data.votes_count} من ${data.players.length}`;

    const optionsContainer = document.getElementById("bluffOptionsContainer");
    optionsContainer.innerHTML = "";

    const myVote = currentBluffRoomData && currentBluffRoomData.votes
        ? currentBluffRoomData.votes[currentBluffPlayerId]
        : null;

    data.answer_options.forEach((option) => {
        const div = document.createElement("div");
        div.className = "vote-item";

        const isOwnOption = option.author_ids.includes(currentBluffPlayerId);
        const isSelected = myVote === option.id;

        let buttonHtml = "";
        if (!isOwnOption) {
            buttonHtml = `
                <button class="btn-sm ${isSelected ? 'btn-primary' : ''}"
                        onclick="submitBluffVote('${option.id}')">
                    ${isSelected ? 'تم التصويت' : 'تصويت'}
                </button>
            `;
        }

        div.innerHTML = `
            <span>${option.text}${isOwnOption ? " (إجابتك)" : ""}</span>
            ${buttonHtml}
        `;

        optionsContainer.appendChild(div);
    });

    renderBluffScoreboard(data.players, "bluffScoreboardVoting");
}

/**
 * Render round result screen.
 */
function renderBluffRoundResult(data) {
    hideAllBluffScreens();
    document.getElementById("screen-bluff-result").classList.remove("hidden");

    document.getElementById("bluffResultMessage").textContent =
        data.last_round_message || "انتهت الجولة.";

    const resultsContainer = document.getElementById("bluffResultsContainer");
    resultsContainer.innerHTML = "";

    data.answer_options.forEach((option) => {
        const div = document.createElement("div");
        div.className = "vote-item";

        let label = option.text;
        if (option.id === data.last_round_correct_option_id) {
            label += " ✅";
        }

        div.innerHTML = `<span>${label} — ${option.votes_received} صوت</span>`;
        resultsContainer.appendChild(div);
    });

    const scoreChanges = document.getElementById("bluffScoreChanges");
    scoreChanges.innerHTML = "";

    const changes = data.last_round_score_changes || {};
    if (Object.keys(changes).length === 0) {
        const div = document.createElement("div");
        div.textContent = "لم يحصل أحد على نقاط في هذه الجولة.";
        scoreChanges.appendChild(div);
    } else {
        Object.entries(changes).forEach(([playerId, delta]) => {
            const player = data.players.find((p) => p.id === playerId);
            if (!player) return;

            const div = document.createElement("div");
            div.textContent = `${player.name}: +${delta}`;
            scoreChanges.appendChild(div);
        });
    }

    renderBluffScoreboard(data.players, "bluffScoreboardResult");

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

/**
 * Render final screen.
 */
function renderBluffGameOver(data) {
    hideAllBluffScreens();
    document.getElementById("screen-bluff-game-over").classList.remove("hidden");

    const winners = data.players.filter((player) => data.winner_ids.includes(player.id));
    const winnerNames = winners.map((player) => player.name).join(" / ");

    document.getElementById("bluffFinalMsg").textContent =
        winners.length > 1
            ? `انتهت اللعبة! تعادل بين: ${winnerNames}`
            : `الفائز هو: ${winnerNames}`;

    renderBluffScoreboard(data.players, "bluffScoreboardFinal");

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

/**
 * Render scoreboard into a container.
 */
function renderBluffScoreboard(players, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = "";

    [...players]
        .sort((a, b) => b.score - a.score)
        .forEach((player) => {
            const badge = document.createElement("span");
            badge.style.background = "#333";
            badge.style.padding = "5px 10px";
            badge.style.borderRadius = "5px";
            badge.textContent = `${player.name}: ${player.score}`;
            container.appendChild(badge);
        });
}

/**
 * Reset local state and reload page.
 */
function resetBluffAndExit() {
    clearBluffLocalState();
    window.location.reload();
}

/**
 * Clear bluff local storage + memory state.
 */
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
}

/**
 * Hide all bluff screens.
 */
function hideAllBluffScreens() {
    const screens = [
        "screen-bluff-lobby",
        "screen-bluff-setup",
        "screen-bluff-wait",
        "screen-bluff-writing",
        "screen-bluff-voting",
        "screen-bluff-result",
        "screen-bluff-game-over"
    ];

    screens.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add("hidden");
        }
    });
}

/**
 * Poll room state every few seconds.
 */
setInterval(async () => {
    if (currentBluffRoomCode && currentBluffPlayerId) {
        await refreshBluffRoomState();
    }
}, 3000);