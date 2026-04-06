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
const MAX_CATEGORIES = 12;

const bluffPlayerCountOptions = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const bluffRoundsOptions = [2, 3, 4, 5, 6, 7, 8, 9, 10];

const bluffCategoryLabels = {
    capitals: "دول",
    football: "كرة قدم",
    syria: "سوريا",
    general: "معلومات عامة",
    strange_facts: "معلومات غريبة",
    islam: "إسلاميات",
    history: "تاريخ",
    animals: "حيوانات",
    proverbs: "أمثال شامية",
    player_career: "مسيرة لاعب",
};

document.addEventListener("DOMContentLoaded", async () => {
    renderBluffPlayerCountButtons();
    renderBluffRoundsButtons();
    await loadBluffCategories();

    if (currentBluffPlayerName) {
        const nameInput = document.getElementById("bluffName");
        if (nameInput) nameInput.value = currentBluffPlayerName;
    }

    if (currentBluffRoomCode) {
        const roomInput = document.getElementById("bluffRoomInput");
        if (roomInput) roomInput.value = currentBluffRoomCode;
    }

    if (currentBluffRoomCode && currentBluffPlayerId) {
        await refreshBluffRoomState();
    }
});

async function loadBluffCategories() {
    const response = await fetch("/api/bluff/categories");
    const data = await response.json();

    const container = document.getElementById("bluffCategoryGrid");
    if (!container) return;

    container.innerHTML = "";

    (data.categories || []).forEach((key) => {
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
        button.onclick = () => {
            selectedBluffPlayerCount = count;
            if (selectedBluffRounds && selectedBluffRounds < count) {
                selectedBluffRounds = count;
            }
            updateBluffPlayerCountButtonsState();
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

    bluffRoundsOptions.forEach((rounds) => {
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

function goBackToBluffLobby() {
    hideAllBluffScreens();
    document.getElementById("screen-bluff-lobby").classList.remove("hidden");
}

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

    if (totalRounds < playerCount) {
        alert("عدد الجولات يجب أن يكون على الأقل بعدد اللاعبين.");
        return;
    }

    if (selectedBluffCategories.length === 0) {
        alert("اختر تصنيفاً واحداً على الأقل!");
        return;
    }

    const response = await fetch("/api/bluff/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

async function joinBluffRoom() {
    const name = document.getElementById("bluffName").value.trim();
    const roomCode = document.getElementById("bluffRoomInput").value.trim().toUpperCase();

    if (!name || !roomCode) {
        alert("اكمل البيانات!");
        return;
    }

    const response = await fetch(`/api/bluff/rooms/${roomCode}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        alert(data.detail || "تعذر اختيار التصنيف.");
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
        alert("اكتب إجابة أولاً.");
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
        alert(data.detail || "تعذر إرسال الإجابة.");
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
        alert(data.detail || "تعذر إرسال الاختيار.");
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
        alert(data.detail || "تعذر الانتقال للجولة التالية.");
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
        alert("اختر عدد الجولات أولاً!");
        return;
    }

    if (categories.length === 0) {
        alert("اختر تصنيفاً واحداً على الأقل!");
        return;
    }

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            categories,
            total_rounds: totalRounds
        })
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.detail || "تعذر إعادة اللعبة.");
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
        alert(data.detail || "تعذر الخروج من الغرفة.");
        return;
    }

    clearBluffLocalState();
    window.location.reload();
}

async function deleteBluffRoom() {
    if (!currentBluffRoomCode || !currentBluffPlayerId) return;

    const confirmed = confirm("هل أنت متأكد أنك تريد حذف الغرفة بالكامل؟");
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
        alert(data.detail || "تعذر حذف الغرفة.");
        return;
    }

    clearBluffLocalState();
    window.location.reload();
}

async function refreshBluffRoomState() {
    if (!currentBluffRoomCode) return;

    const response = await fetch(`/api/bluff/rooms/${currentBluffRoomCode}`);
    if (!response.ok) return;

    const data = await response.json();
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
        return;
    }

    if (!data.started || data.phase === "waiting") {
        renderBluffWaitingRoom(data);
        return;
    }

    if (data.phase === "category_pick") {
        renderBluffCategoryPickPhase(data);
        return;
    }

    if (data.phase === "submission") {
        renderBluffSubmissionPhase(data);
        return;
    }

    if (data.phase === "answer_pick") {
        renderBluffAnswerPickPhase(data);
        return;
    }

    if (data.phase === "round_result") {
        renderBluffRoundResult(data);
    }
}

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
        current_category_chooser_id: data.current_category_chooser_id,
        current_round_category: data.current_round_category,
        current_question: data.current_question,
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

    const playerList = document.getElementById("bluffPlayerList");
    playerList.innerHTML = "";

    data.players.forEach((player) => {
        const badge = document.createElement("span");
        badge.className = "player-chip";
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

    renderBluffPlayerStatusList(data, "bluffPlayerStatusCategoryPick", "idle");
    renderBluffScoreboard(data.players, "bluffScoreboardCategoryPick");
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

    renderBluffPlayerStatusList(data, "bluffPlayerStatusSubmission", "submitted");
    renderBluffScoreboard(data.players, "bluffScoreboardSubmission");
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
    renderBluffPlayerStatusList(data, "bluffPlayerStatusAnswerPick", "picked");

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

    renderBluffScoreboard(data.players, "bluffScoreboardAnswerPick");
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

    (data.answer_options || []).forEach((option) => {
        const row = document.createElement("tr");

        const authorNames = (option.author_ids || []).length > 0
            ? option.author_ids
                .map((authorId) => {
                    const player = data.players.find((p) => p.id === authorId);
                    return player ? player.name : "لاعب غير معروف";
                })
                .join(" / ")
            : "الإجابة الصحيحة✅";


        if (option.id === data.last_round_correct_option_id) {
            row.classList.add("correct-answer-row");
        }

        row.innerHTML = `
            <td>${escapeHtml(option.text)}</td>
            <td>${escapeHtml(authorNames)}</td>
            <td>${option.votes_received ?? 0}</td>
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
            <td>${escapeHtml(player.name)}</td>
            <td>${player.score}</td>
            <td>${delta > 0 ? `+${delta}` : "-"}</td>
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

    const winners = data.players.filter((player) => data.winner_ids.includes(player.id));
    const winnerNames = winners.map((player) => player.name).join(" / ");

    document.getElementById("bluffFinalMsg").textContent =
        winners.length > 1
            ? `انتهت اللعبة! تعادل بين: ${winnerNames}`
            : `الفائز هو: ${winnerNames}`;

    renderBluffScoreboard(data.players, "bluffScoreboardFinal", true);

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
        const item = document.createElement("div");
        item.className = "player-status-chip";

        let dimmed = false;
        if (mode === "submitted") dimmed = submittedIds.has(player.id);
        if (mode === "picked") dimmed = pickedIds.has(player.id);

        if (dimmed) item.classList.add("done");
        if (player.id === data.current_category_chooser_id && data.phase === "category_pick") {
            item.classList.add("current-turn");
        }

        item.textContent = player.name;
        container.appendChild(item);
    });
}

function renderBluffScoreboard(players, containerId, withPodium = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = "";

    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);

    sortedPlayers.forEach((player, index) => {
        const badge = document.createElement("span");
        badge.className = "player-chip";

        if (withPodium || containerId === "bluffScoreboardResult") {
            if (index === 0) badge.classList.add("podium-gold");
            if (index === 1) badge.classList.add("podium-silver");
            if (index === 2) badge.classList.add("podium-bronze");
        }

        badge.textContent = `${player.name}: ${player.score}`;
        container.appendChild(badge);
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

setInterval(() => {
    if (currentBluffRoomData) {
        updateBluffLiveTimer(currentBluffRoomData);
    }
}, 1000);