const API_BASE_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:5000/api"
  : "https://peladaplay.onrender.com/api";


const state = {
  token: localStorage.getItem("pp_token") || null,
  profile: null,
  clubs: [],
  currentClubId: localStorage.getItem("pp_club_id") || null,
  currentClubDetails: null,
  matches: [],
  currentMatchId: null,
  currentMatchDetails: null,
  venues: [],
  countdownTimer: null
};

const FOOT_LABELS = ["Destro", "Canhoto", "Ambidestro"];
const ROLE_LABELS = ["Jogador", "Sub-Organizador", "Organizador"];
const DAY_LABELS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

// ================= INICIALIZAÇÃO & SERVICE WORKER =================
document.addEventListener("DOMContentLoaded", () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  if (state.token) {
    bootApp();
  } else {
    showAuth();
  }
});

// ================= HELPERS HTTP & UI =================
function showToast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${isError ? "error" : ""}`;
  setTimeout(() => el.classList.add("hidden"), 4000);
}

async function apiFetch(endpoint, options = {}, retryCount = 0) {
  const headers = {
    "Content-Type": "application/json",
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    ...(options.headers || {})
  };

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
  } catch (networkErr) {
    // Se o servidor gratuito do Render estiver acordando, tenta mais 1 vez automaticamente
    if (retryCount < 1) {
      showToast("Conectando ao servidor (acordando API)...");
      await new Promise(r => setTimeout(r, 3500));
      return apiFetch(endpoint, options, retryCount + 1);
    }
    throw new Error("Não foi possível conectar ao servidor. Aguarde alguns segundos e tente novamente.");
  }

  if (res.status === 401) {
    logout();
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  if (res.status === 403) {
    throw new Error("Você não tem permissão para esta ação.");
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!res.ok) {
    throw new Error(data?.message || `Erro HTTP ${res.status}`);
  }
  return data;
}

function formatMoney(val) {
  return Number(val || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }) +
    " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function showAuth() {
  document.getElementById("auth-view").classList.remove("hidden");
  document.getElementById("app-view").classList.add("hidden");
}

function switchAuthTab(tab) {
  document.getElementById("tab-login").classList.toggle("active", tab === "login");
  document.getElementById("tab-register").classList.toggle("active", tab === "register");
  document.getElementById("login-form").classList.toggle("hidden", tab !== "login");
  document.getElementById("register-form").classList.toggle("hidden", tab !== "register");
}

function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
}

function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

function navigateTo(pageId) {
  document.querySelectorAll(".page-section").forEach(sec => sec.classList.add("hidden"));
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active"));

  const target = document.getElementById(`page-${pageId}`);
  if (target) target.classList.remove("hidden");

  const navBtn = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  if (navBtn) navBtn.classList.add("active");
}

// ================= AUTENTICAÇÃO =================
function saveCredentialsInBrowser(email, password, name) {
  try {
    if (window.PasswordCredential && navigator.credentials) {
      const cred = new window.PasswordCredential({
        id: email,
        password: password,
        name: name || email
      });
      navigator.credentials.store(cred).catch(() => {});
    }
  } catch {}
}

async function handleLogin(e) {
  e.preventDefault();
  try {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const res = await apiFetch("/Auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    saveCredentialsInBrowser(email, password, res.fullName);
    state.token = res.token;
    localStorage.setItem("pp_token", res.token);
    await bootApp();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  try {
    const email = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value;
    const payload = {
      fullName: document.getElementById("reg-name").value,
      email,
      password,
      position: document.getElementById("reg-position").value,
      preferredFoot: Number(document.getElementById("reg-foot").value),
      shirtNumber: Number(document.getElementById("reg-shirt").value),
      city: null,
      phone: null
    };
    const res = await apiFetch("/Auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    saveCredentialsInBrowser(email, password, payload.fullName);
    state.token = res.token;
    localStorage.setItem("pp_token", res.token);
    showToast("PRO ID gerado com sucesso!");
    await bootApp();
  } catch (err) {
    showToast(err.message, true);
  }
}

function logout() {
  state.token = null;
  state.profile = null;
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  localStorage.removeItem("pp_token");
  localStorage.removeItem("pp_club_id");
  showAuth();
}

// ================= BOOT DO APP =================
async function bootApp() {
  document.getElementById("auth-view").classList.add("hidden");
  document.getElementById("app-view").classList.remove("hidden");

  try {
    await Promise.all([loadProfile(), loadVenues()]);
    renderClubSelector();

    if (state.clubs.length > 0) {
      const validId = state.clubs.some(c => c.clubId === state.currentClubId)
        ? state.currentClubId
        : state.clubs[0].clubId;
      await selectClub(validId);
    } else {
      renderEmptyClubState();
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

async function loadProfile() {
  const me = await apiFetch("/Auth/me");
  state.profile = me;
  state.clubs = me.clubs || [];

  // Home PRO ID card
  document.getElementById("home-pro-name").textContent = me.fullName;
  document.getElementById("home-pro-shirt").textContent = `#${me.shirtNumber}`;
  document.getElementById("home-pro-meta").textContent = `${me.position} • ${FOOT_LABELS[me.preferredFoot] || "Destro"}`;
  document.getElementById("home-stat-matches").textContent = me.stats.matches;
  document.getElementById("home-stat-goals").textContent = me.stats.goals;
  document.getElementById("home-stat-assists").textContent = me.stats.assists;

  // Profile page
  document.getElementById("prof-name").textContent = me.fullName;
  document.getElementById("prof-email").textContent = me.email;
  document.getElementById("prof-shirt").textContent = `#${me.shirtNumber}`;
  document.getElementById("prof-meta").textContent = `${me.position} • ${FOOT_LABELS[me.preferredFoot] || "Destro"} • ${me.city || "Brasil"}`;
  document.getElementById("prof-stat-matches").textContent = me.stats.matches;
  document.getElementById("prof-stat-goals").textContent = me.stats.goals;
  document.getElementById("prof-stat-assists").textContent = me.stats.assists;
  document.getElementById("prof-stat-avg").textContent = me.stats.contributionsPerGame;

  const avatar = me.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(me.fullName)}&background=00F5A0&color=061014&bold=true`;
  document.getElementById("prof-avatar").src = avatar;

  // Preencher formulário de edição
  document.getElementById("edit-name").value = me.fullName;
  document.getElementById("edit-position").value = me.position;
  document.getElementById("edit-foot").value = me.preferredFoot;
  document.getElementById("edit-shirt").value = me.shirtNumber;
  document.getElementById("edit-city").value = me.city || "";
  document.getElementById("edit-phone").value = me.phone || "";
  document.getElementById("edit-photo").value = me.photoUrl || "";
  document.getElementById("edit-pix-key").value = me.pixKey || "";

  // Vínculos por clube
  const clubsContainer = document.getElementById("prof-clubs-list");
  if (state.clubs.length === 0) {
    clubsContainer.innerHTML = `<p class="muted-text">Você ainda não participa de nenhum clube.</p>`;
  } else {
    clubsContainer.innerHTML = state.clubs.map(c => `
      <div class="list-item">
        <div>
          <strong>${c.clubName}</strong>
          <div class="muted-text" style="font-size:0.82rem;">Cargo: ${ROLE_LABELS[c.role]} • Nível: ${"★".repeat(c.skillRank)}</div>
        </div>
        <span class="badge-titanium">${ROLE_LABELS[c.role]}</span>
      </div>
    `).join("");
  }
}

async function handleUpdateProfile(e) {
  e.preventDefault();
  try {
    const payload = {
      fullName: document.getElementById("edit-name").value,
      position: document.getElementById("edit-position").value,
      preferredFoot: Number(document.getElementById("edit-foot").value),
      shirtNumber: Number(document.getElementById("edit-shirt").value),
      city: document.getElementById("edit-city").value || null,
      phone: document.getElementById("edit-phone").value || null,
      photoUrl: document.getElementById("edit-photo").value || null,
      pixKey: document.getElementById("edit-pix-key").value || null
    };
    const res = await apiFetch("/Auth/me", { method: "PUT", body: JSON.stringify(payload) });
    showToast(res.message);
    await loadProfile();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ================= CLUBES & ELENCO =================
function renderClubSelector() {
  const sel = document.getElementById("club-selector");
  if (state.clubs.length === 0) {
    sel.innerHTML = `<option value="">Nenhum clube ainda...</option>`;
    return;
  }
  sel.innerHTML = state.clubs.map(c =>
    `<option value="${c.clubId}">${c.clubName} (${ROLE_LABELS[c.role]})</option>`
  ).join("");
  if (state.currentClubId) sel.value = state.currentClubId;
}

function renderEmptyClubState() {
  document.getElementById("club-title").textContent = "Bem-vindo ao PeladaPlay!";
  document.getElementById("club-schedule").textContent = "Clique em '+ Clube / Convite' no topo para criar sua pelada ou entrar com um código.";
  document.getElementById("club-role-badge").textContent = "SEM CLUBE";
  document.getElementById("club-invite-code").textContent = "---";
  document.getElementById("club-reserve").textContent = "R$ 0,00";
  document.getElementById("btn-new-match-home").classList.add("hidden");
  document.getElementById("btn-quick-next-match").classList.add("hidden");
  document.getElementById("btn-new-match-page").classList.add("hidden");
  document.getElementById("btn-quick-next-match-page").classList.add("hidden");
  document.getElementById("btn-club-settings").classList.add("hidden");
  document.getElementById("matches-list").innerHTML = `<p class="muted-text">Entre ou crie um clube primeiro.</p>`;
  document.getElementById("squad-list").innerHTML = "";
  document.getElementById("rankings-list").innerHTML = "";
}

async function selectClub(clubId) {
  if (!clubId) return;
  state.currentClubId = clubId;
  localStorage.setItem("pp_club_id", clubId);
  document.getElementById("club-selector").value = clubId;

  try {
    const [club, matches, rankings] = await Promise.all([
      apiFetch(`/Clubs/${clubId}`),
      apiFetch(`/Matches/club/${clubId}`),
      apiFetch(`/Matches/club/${clubId}/rankings`)
    ]);

    state.currentClubDetails = club;
    state.matches = matches;

    const isStaff = club.myRole >= 1; // SubOrg (1) ou Admin (2)

    document.getElementById("club-title").textContent = club.name;
    document.getElementById("club-role-badge").textContent = ROLE_LABELS[club.myRole].toUpperCase();
    document.getElementById("club-invite-code").textContent = `CÓD: ${club.inviteCode}`;
    document.getElementById("club-reserve").textContent = formatMoney(club.cashReserve);

    const venueTxt = club.defaultVenue ? ` • ${club.defaultVenue.name}` : "";
    const timeFormatted = club.defaultTime ? club.defaultTime.slice(0, 5) : "20:00";
    document.getElementById("club-schedule").textContent =
      `Toda ${DAY_LABELS[club.defaultDayOfWeek]} às ${timeFormatted} • ${club.expectedPlayers} vagas${venueTxt}`;

    document.getElementById("btn-new-match-home").classList.toggle("hidden", !isStaff);
    document.getElementById("btn-quick-next-match").classList.toggle("hidden", !isStaff);
    document.getElementById("btn-new-match-page").classList.toggle("hidden", !isStaff);
    document.getElementById("btn-quick-next-match-page").classList.toggle("hidden", !isStaff);
    document.getElementById("btn-club-settings").classList.toggle("hidden", !isStaff);

    renderMatchesList(matches);
    renderHomeNextMatch(matches);
    renderSquadList(club);
    renderRankingsList(rankings);

    if (matches.length > 0) {
      const keepId = matches.some(m => m.id === state.currentMatchId) ? state.currentMatchId : matches[0].id;
      await openMatchDetail(keepId);
    } else {
      document.getElementById("match-detail-panel").classList.add("hidden");
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

function copyInviteCode() {
  if (!state.currentClubDetails) return;
  navigator.clipboard.writeText(state.currentClubDetails.inviteCode);
  showToast(`Código ${state.currentClubDetails.inviteCode} copiado!`);
}

function openClubModal() {
  const sel = document.getElementById("new-club-venue");
  sel.innerHTML = `<option value="">Sem quadra fixa</option>` +
    state.venues.map(v => `<option value="${v.id}">${v.name} ${v.defaultPrice ? `(${formatMoney(v.defaultPrice)})` : "(Sob consulta)"}</option>`).join("");
  openModal("modal-club");
}

async function handleCreateClub(e) {
  e.preventDefault();
  try {
    const venueVal = document.getElementById("new-club-venue").value;
    const payload = {
      name: document.getElementById("new-club-name").value,
      defaultVenueId: venueVal || null,
      defaultDayOfWeek: Number(document.getElementById("new-club-day").value),
      defaultTime: document.getElementById("new-club-time").value + ":00",
      expectedPlayers: Number(document.getElementById("new-club-players").value),
      playersPerTeam: Number(document.getElementById("new-club-per-team").value),
      goalkeepersPay: document.getElementById("new-club-gk-pay").checked
    };
    const res = await apiFetch("/Clubs", { method: "POST", body: JSON.stringify(payload) });
    closeModal("modal-club");
    showToast("Clube criado! Você é o Organizador.");
    await loadProfile();
    renderClubSelector();
    await selectClub(res.id);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleJoinClub(e) {
  e.preventDefault();
  try {
    const inviteCode = document.getElementById("invite-code-input").value.trim();
    const res = await apiFetch("/Clubs/join", { method: "POST", body: JSON.stringify({ inviteCode }) });
    closeModal("modal-club");
    showToast(res.message);
    await loadProfile();
    renderClubSelector();
    await selectClub(res.clubId);
  } catch (err) {
    showToast(err.message, true);
  }
}

function openClubSettingsModal() {
  const club = state.currentClubDetails;
  if (!club) return;
  document.getElementById("set-club-name").value = club.name;
  document.getElementById("set-club-day").value = club.defaultDayOfWeek;
  document.getElementById("set-club-time").value = club.defaultTime.slice(0, 5);
  document.getElementById("set-club-players").value = club.expectedPlayers;
  document.getElementById("set-club-per-team").value = club.playersPerTeam;
  document.getElementById("set-club-gk-pay").checked = club.goalkeepersPay;
  openModal("modal-club-settings");
}

async function handleUpdateClubSettings(e) {
  e.preventDefault();
  try {
    const club = state.currentClubDetails;
    const payload = {
      name: document.getElementById("set-club-name").value,
      defaultVenueId: club.defaultVenue?.id || null,
      defaultDayOfWeek: Number(document.getElementById("set-club-day").value),
      defaultTime: document.getElementById("set-club-time").value + ":00",
      expectedPlayers: Number(document.getElementById("set-club-players").value),
      playersPerTeam: Number(document.getElementById("set-club-per-team").value),
      goalkeepersPay: document.getElementById("set-club-gk-pay").checked
    };
    const res = await apiFetch(`/Clubs/${club.id}`, { method: "PUT", body: JSON.stringify(payload) });
    closeModal("modal-club-settings");
    showToast(res.message);
    await selectClub(club.id);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleAdjustReserve(e) {
  e.preventDefault();
  try {
    const op = document.getElementById("reserve-op").value;
    const rawAmount = Number(document.getElementById("reserve-amount").value);
    const amount = op === "withdraw" ? -Math.abs(rawAmount) : Math.abs(rawAmount);

    const res = await apiFetch(`/Clubs/${state.currentClubId}/cash-reserve`, {
      method: "PATCH",
      body: JSON.stringify({ amount, reason: "Ajuste manual" })
    });
    document.getElementById("reserve-amount").value = "";
    closeModal("modal-club-settings");
    showToast(res.message);
    await selectClub(state.currentClubId);
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderSquadList(club) {
  const container = document.getElementById("squad-list");
  document.getElementById("squad-count-badge").textContent = `${club.members.length} atletas`;
  const isStaff = club.myRole >= 1;
  const isAdmin = club.myRole === 2;

  container.innerHTML = club.members.map(m => {
    const stars = [1, 2, 3, 4, 5].map(s =>
      `<button class="star-btn ${s <= m.skillRank ? "active" : ""}" ${!isStaff ? "disabled" : ""} onclick="updateMemberRank('${m.userId}', ${s}, ${m.isGoalkeeper})">★</button>`
    ).join("");

    const roleSelect = isAdmin && m.userId !== state.profile.id
      ? `<select class="mini-select" onchange="updateMemberRole('${m.userId}', Number(this.value))">
          <option value="0" ${m.role === 0 ? "selected" : ""}>Jogador</option>
          <option value="1" ${m.role === 1 ? "selected" : ""}>Sub-Org</option>
          <option value="2" ${m.role === 2 ? "selected" : ""}>Admin</option>
         </select>`
      : `<span class="badge-titanium">${ROLE_LABELS[m.role]}</span>`;

    return `
      <div class="list-item">
        <div>
          <strong>#${m.shirtNumber} ${m.fullName}</strong> ${m.isGoalkeeper ? "🧤" : ""}
          <div class="muted-text" style="font-size:0.82rem;">${m.position}</div>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <div>${stars}</div>
          ${roleSelect}
        </div>
      </div>
    `;
  }).join("");
}

async function updateMemberRank(userId, skillRank, isGoalkeeper) {
  try {
    await apiFetch(`/Clubs/${state.currentClubId}/members/${userId}/rank`, {
      method: "PATCH",
      body: JSON.stringify({ skillRank, isGoalkeeper })
    });
    showToast("Nível técnico atualizado!");
    await selectClub(state.currentClubId);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function updateMemberRole(userId, role) {
  try {
    await apiFetch(`/Clubs/${state.currentClubId}/members/${userId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role })
    });
    showToast("Cargo atualizado com sucesso!");
    await selectClub(state.currentClubId);
  } catch (err) {
    showToast(err.message, true);
  }
}

// ================= PARTIDAS, LISTA, PIX 24H E TIMES =================
function getNextClubDateTimeLocal(club) {
  const now = new Date();
  const targetDay = club.defaultDayOfWeek;
  const [hh, mm] = club.defaultTime.split(":").map(Number);

  const candidate = new Date(now);
  candidate.setHours(hh, mm, 0, 0);

  let diffDays = (targetDay - now.getDay() + 7) % 7;
  if (diffDays === 0 && candidate <= now) {
    diffDays = 7;
  }
  candidate.setDate(now.getDate() + diffDays);

  const pad = n => String(n).padStart(2, "0");
  return `${candidate.getFullYear()}-${pad(candidate.getMonth() + 1)}-${pad(candidate.getDate())}T${pad(hh)}:${pad(mm)}`;
}

async function quickScheduleNextWeeklyMatch() {
  const club = state.currentClubDetails;
  if (!club) return;

  const nextDateStr = getNextClubDateTimeLocal(club);
  const cost = club.defaultVenue?.defaultPrice || 300;
  const defaultPix = state.profile?.pixKey || state.profile?.email || "";

  try {
    const res = await apiFetch("/Matches", {
      method: "POST",
      body: JSON.stringify({
        clubId: club.id,
        matchDateTime: nextDateStr,
        courtCost: cost,
        pixReceiverName: state.profile?.fullName || "Organizador",
        pixKey: defaultPix
      })
    });
    showToast("Próxima pelada semanal criada!");
    await selectClub(club.id);
    await openMatchDetail(res.id);
    navigateTo("matches");
  } catch (err) {
    showToast(err.message, true);
  }
}

function openMatchModal() {
  const club = state.currentClubDetails;
  const sel = document.getElementById("match-venue-select");
  sel.innerHTML = `<option value="">Digitar valor manualmente</option>` +
    state.venues.map(v => `<option value="${v.id}" data-price="${v.defaultPrice || ""}">${v.name} ${v.defaultPrice ? `(${formatMoney(v.defaultPrice)})` : "(Sob consulta)"}</option>`).join("");

  if (club) {
    document.getElementById("match-datetime").value = getNextClubDateTimeLocal(club);
    if (club.defaultVenue) {
      sel.value = club.defaultVenue.id;
      if (club.defaultVenue.defaultPrice) {
        document.getElementById("match-cost").value = club.defaultVenue.defaultPrice;
      }
    }
  }
  document.getElementById("match-pix-name").value = state.profile?.fullName || "";
  document.getElementById("match-pix-key").value = state.profile?.pixKey || state.profile?.email || "";
  openModal("modal-match");
}

function applyVenuePriceToMatch(venueId) {
  const venue = state.venues.find(v => v.id === venueId);
  if (venue && venue.defaultPrice) {
    document.getElementById("match-cost").value = venue.defaultPrice;
  }
}

async function handleCreateMatch(e) {
  e.preventDefault();
  try {
    const payload = {
      clubId: state.currentClubId,
      matchDateTime: document.getElementById("match-datetime").value,
      courtCost: Number(document.getElementById("match-cost").value),
      pixReceiverName: document.getElementById("match-pix-name").value || null,
      pixKey: document.getElementById("match-pix-key").value || null
    };
    const res = await apiFetch("/Matches", { method: "POST", body: JSON.stringify(payload) });
    closeModal("modal-match");
    showToast(res.message);
    await selectClub(state.currentClubId);
    await openMatchDetail(res.id);
    navigateTo("matches");
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderHomeNextMatch(matches) {
  const box = document.getElementById("home-next-match");
  if (matches.length === 0) {
    box.innerHTML = `<p class="muted-text">Nenhuma partida agendada para este clube.</p>`;
    return;
  }
  const m = matches[0];
  const statusMap = ["Lista Aberta", "Janela Pix Aberta", "Finalizada"];
  box.innerHTML = `
    <div class="list-item" style="cursor:pointer" onclick="navigateTo('matches'); openMatchDetail('${m.id}')">
      <div>
        <strong>${formatDateTime(m.matchDateTime)}</strong>
        <div class="muted-text" style="font-size:0.85rem;">Quadra: ${formatMoney(m.courtCost)} • ${m.confirmedCount} confirmados (${m.waitlistCount} espera)</div>
      </div>
      <span class="badge-neon">${statusMap[m.status]}</span>
    </div>
  `;
}

function renderMatchesList(matches) {
  const container = document.getElementById("matches-list");
  if (matches.length === 0) {
    container.innerHTML = `<p class="muted-text">Nenhuma pelada agendada ainda.</p>`;
    return;
  }
  const statusMap = ["Lista Aberta", "Pix Aberto", "Finalizada"];
  container.innerHTML = matches.map(m => `
    <div class="match-card ${m.id === state.currentMatchId ? "selected" : ""}" onclick="openMatchDetail('${m.id}')">
      <div class="card-top">
        <span class="badge-neon">${statusMap[m.status]}</span>
        <span class="mono-tag">${formatMoney(m.courtCost)}</span>
      </div>
      <strong>${formatDateTime(m.matchDateTime)}</strong>
      <div class="muted-text" style="font-size:0.83rem; margin-top:6px;">
        ✅ ${m.confirmedCount} na lista • ⏳ ${m.waitlistCount} espera • 💰 ${m.paidCount} pagos
      </div>
    </div>
  `).join("");
}

function startPixCountdown(match) {
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  const el = document.getElementById("detail-pix-countdown");

  const updateTick = () => {
    if (match.status === 2) {
      el.textContent = "🏁 Partida Encerrada";
      return;
    }
    if (match.status === 1) {
      el.textContent = "🔒 Valores Congelados (Pix Aberto)";
      return;
    }
    const matchMs = new Date(match.matchDateTime).getTime();
    const pixOpenMs = matchMs - 24 * 60 * 60 * 1000;
    const diff = pixOpenMs - Date.now();

    if (diff <= 0) {
      el.textContent = "⚡ Janela Pix Liberada!";
      return;
    }
    const hrs = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    el.textContent = `⏳ Pix abre em ${hrs}h ${mins}m`;
  };

  updateTick();
  state.countdownTimer = setInterval(updateTick, 30000);
}

async function openMatchDetail(matchId) {
  state.currentMatchId = matchId;
  renderMatchesList(state.matches);

  try {
    const d = await apiFetch(`/Matches/${matchId}`);
    state.currentMatchDetails = d;

    const panel = document.getElementById("match-detail-panel");
    panel.classList.remove("hidden");

    const statusLabels = ["LISTA ABERTA (RATEIO DINÂMICO)", "JANELA PIX ABERTA (VALORES CONGELADOS)", "PARTIDA FINALIZADA"];
    document.getElementById("detail-status-badge").textContent = statusLabels[d.status];
    document.getElementById("detail-title").textContent = `${d.clubName} — ${formatDateTime(d.matchDateTime)}`;
    document.getElementById("detail-subtitle").textContent =
      `Quadra: ${formatMoney(d.courtCost)} • Vagas: ${d.expectedPlayers} • ${d.goalkeepersPay ? "Goleiros pagam" : "Goleiros isentos"}`;

    startPixCountdown(d);

    document.getElementById("fin-per-player").textContent = formatMoney(d.financialSummary.estimatedPerPlayer);
    document.getElementById("fin-collected").textContent = formatMoney(d.financialSummary.totalCollected);
    document.getElementById("fin-surplus").textContent = formatMoney(d.financialSummary.surplusToReserve);
    document.getElementById("fin-pix-key").textContent = d.pixKey
      ? `${d.pixKey} (${d.pixReceiverName || "Org."})`
      : "Não informada";

    const isStaff = d.myRole >= 1;
    const isFinished = d.status === 2;

    document.getElementById("btn-open-pix").classList.toggle("hidden", !isStaff || d.status !== 0);
    document.getElementById("btn-draw-teams").classList.toggle("hidden", !isStaff || isFinished);
    document.getElementById("guest-bar").classList.toggle("hidden", !isStaff || isFinished);
    document.getElementById("sumula-admin-bar").classList.toggle("hidden", !isStaff || d.isSumulaValidated);
    document.getElementById("btn-edit-match-pix").classList.toggle("hidden", !isStaff || isFinished);

    const alreadyIn = d.registrations.some(r => r.userId === state.profile.id);
    document.getElementById("btn-join-match").classList.toggle("hidden", alreadyIn || isFinished);
    document.getElementById("btn-join-gk").classList.toggle("hidden", alreadyIn || isFinished);

    renderRoster(d);
    renderTeams(d);
    renderSumula(d);
  } catch (err) {
    showToast(err.message, true);
  }
}

function openEditMatchPixModal() {
  const d = state.currentMatchDetails;
  if (!d) return;
  document.getElementById("edit-match-pix-name").value = d.pixReceiverName || state.profile?.fullName || "";
  document.getElementById("edit-match-pix-key").value = d.pixKey || state.profile?.pixKey || "";
  openModal("modal-edit-match-pix");
}

function fillMyDefaultPixInModal() {
  document.getElementById("edit-match-pix-name").value = state.profile?.fullName || "";
  document.getElementById("edit-match-pix-key").value = state.profile?.pixKey || state.profile?.email || "";
}

async function handleUpdateMatchPix(e) {
  e.preventDefault();
  try {
    const payload = {
      pixReceiverName: document.getElementById("edit-match-pix-name").value.trim(),
      pixKey: document.getElementById("edit-match-pix-key").value.trim()
    };
    const res = await apiFetch(`/Matches/${state.currentMatchId}/pix`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    closeModal("modal-edit-match-pix");
    showToast(res.message);
    await openMatchDetail(state.currentMatchId);
  } catch (err) {
    showToast(err.message, true);
  }
}

function copyMatchPixKey() {
  const d = state.currentMatchDetails;
  if (!d || !d.pixKey) return;
  navigator.clipboard.writeText(d.pixKey);
  showToast(`Chave Pix "${d.pixKey}" copiada!`);
}

function copyWhatsAppRoster() {
  const d = state.currentMatchDetails;
  if (!d) return;

  const main = d.registrations.filter(r => !r.isWaitlist);
  const wait = d.registrations.filter(r => r.isWaitlist);
  const payIcons = ["⏳", "🔔", "✅", "🧤"];

  let text = `⚽ *${d.clubName.toUpperCase()}*\n`;
  text += `📅 ${formatDateTime(d.matchDateTime)}\n`;
  text += `💰 Cota: ${formatMoney(d.financialSummary.estimatedPerPlayer)}\n`;
  if (d.pixKey) text += `🔑 Pix: ${d.pixKey} (${d.pixReceiverName || ""})\n`;
  text += `\n*LISTA CONFIRMADA (${main.length}/${d.expectedPlayers}):*\n`;

  main.forEach((r, idx) => {
    text += `${idx + 1}. ${r.displayName} ${r.isGoalkeeper ? "(GOL)" : ""} ${payIcons[r.paymentStatus]}\n`;
  });

  if (wait.length > 0) {
    text += `\n*FILA DE ESPERA:*\n`;
    wait.forEach((r, idx) => {
      text += `${idx + 1}. ${r.displayName} ${r.isGoalkeeper ? "(GOL)" : ""}\n`;
    });
  }

  navigator.clipboard.writeText(text);
  showToast("Lista formatada copiada para o WhatsApp!");
}

function switchInnerTab(tabName, btnEl) {
  document.querySelectorAll(".inner-tab").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".inner-content").forEach(c => c.classList.add("hidden"));
  btnEl.classList.add("active");
  document.getElementById(`tab-${tabName}`).classList.remove("hidden");
}

function renderRoster(d) {
  const container = document.getElementById("roster-list");
  const isStaff = d.myRole >= 1;
  const payStatusLabels = ["Pendente", "Aguardando Baixa", "Pago ✅", "Isento"];
  const payBadgeClass = ["badge-titanium", "badge-warning", "badge-neon", "badge-titanium"];

  if (d.registrations.length === 0) {
    container.innerHTML = `<p class="muted-text">Nenhum jogador na lista ainda. Clique em "Tô Dentro"!</p>`;
    return;
  }

  container.innerHTML = d.registrations.map((r, i) => {
    const isMe = r.userId === state.profile.id;
    const canRemove = (isMe || isStaff) && d.status !== 2;

    let actionBtns = "";
    if (!r.isWaitlist && d.status === 1 && isMe && r.paymentStatus === 0) {
      actionBtns += `<button class="btn-primary btn-sm" onclick="openPixPaymentModal('${r.id}', ${r.amountToPay})">Pagar Pix</button>`;
    }
    if (!r.isWaitlist && isStaff && r.paymentStatus !== 2 && r.paymentStatus !== 3) {
      actionBtns += `<button class="btn-secondary btn-sm" onclick="confirmPayment('${r.id}', 2)">Dar Baixa</button>`;
    }
    if (canRemove) {
      actionBtns += `<button class="btn-danger-ghost btn-sm" onclick="leaveMatch('${r.id}')">Sair</button>`;
    }

    return `
      <div class="list-item ${r.isWaitlist ? "waitlist-item" : ""}">
        <div>
          <strong>${r.isWaitlist ? "⏳ Espera" : `#${i + 1}`} • ${r.displayName}</strong>
          ${r.isGoalkeeper ? `<span class="badge-titanium">GOL</span>` : ""}
          <div class="muted-text" style="font-size:0.82rem;">
            ${r.isWaitlist ? "Aguardando vaga titular" : `Valor: ${formatMoney(r.amountToPay)}`} • ${"★".repeat(r.skillRank)}
          </div>
        </div>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          ${!r.isWaitlist ? `<span class="${payBadgeClass[r.paymentStatus]}">${payStatusLabels[r.paymentStatus]}</span>` : ""}
          ${actionBtns}
        </div>
      </div>
    `;
  }).join("");
}

function openPixPaymentModal(regId, amount) {
  const d = state.currentMatchDetails;
  document.getElementById("pix-modal-amount").textContent = formatMoney(amount);
  document.getElementById("pix-modal-receiver").textContent = `Recebedor: ${d.pixReceiverName || "Organizador do Clube"}`;
  document.getElementById("pix-modal-key").value = d.pixKey || "Solicite a chave ao organizador no grupo";

  const btn = document.getElementById("pix-modal-confirm-btn");
  btn.onclick = async () => {
    closeModal("modal-pix");
    await notifyPaid(regId);
  };
  openModal("modal-pix");
}

function copyPixFromModal() {
  const key = document.getElementById("pix-modal-key").value;
  navigator.clipboard.writeText(key);
  showToast("Chave Pix copiada!");
}

async function joinCurrentMatch(isGoalkeeper) {
  try {
    const res = await apiFetch(`/Matches/${state.currentMatchId}/join`, {
      method: "POST",
      body: JSON.stringify({ isGoalkeeper })
    });
    showToast(res.message);
    await openMatchDetail(state.currentMatchId);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function addGuest() {
  const input = document.getElementById("guest-name-input");
  const isGoalkeeper = document.getElementById("guest-gk-input").checked;
  if (!input.value.trim()) return;

  try {
    const res = await apiFetch(`/Matches/${state.currentMatchId}/guests`, {
      method: "POST",
      body: JSON.stringify({ guestName: input.value.trim(), isGoalkeeper })
    });
    input.value = "";
    document.getElementById("guest-gk-input").checked = false;
    showToast(res.message);
    await openMatchDetail(state.currentMatchId);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function leaveMatch(registrationId) {
  try {
    const res = await apiFetch(`/Matches/${state.currentMatchId}/leave/${registrationId}`, { method: "DELETE" });
    showToast(res.message);
    await openMatchDetail(state.currentMatchId);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function openPixWindow() {
  try {
    const res = await apiFetch(`/Matches/${state.currentMatchId}/open-pix`, { method: "POST" });
    showToast(res.message);
    await openMatchDetail(state.currentMatchId);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function notifyPaid(registrationId) {
  try {
    const res = await apiFetch(`/Matches/${state.currentMatchId}/registrations/${registrationId}/notify-paid`, { method: "POST" });
    showToast(res.message);
    await openMatchDetail(state.currentMatchId);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function confirmPayment(registrationId, status) {
  try {
    const res = await apiFetch(`/Matches/${state.currentMatchId}/registrations/${registrationId}/payment`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    showToast(res.message);
    await openMatchDetail(state.currentMatchId);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function drawTeams() {
  try {
    const d = state.currentMatchDetails;
    const mainCount = d.registrations.filter(r => !r.isWaitlist).length;
    const numTeams = Math.max(2, Math.round(mainCount / (d.playersPerTeam || 5)));

    const res = await apiFetch(`/Matches/${state.currentMatchId}/draw-teams`, {
      method: "POST",
      body: JSON.stringify({ numberOfTeams: numTeams })
    });
    showToast(res.message);
    await openMatchDetail(state.currentMatchId);
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderTeams(d) {
  const container = document.getElementById("teams-grid");
  const mainPlayers = d.registrations.filter(r => !r.isWaitlist);
  const teams = [...new Set(mainPlayers.map(p => p.teamAssigned).filter(Boolean))].sort();

  const leftSel = document.getElementById("game-left");
  const rightSel = document.getElementById("game-right");
  const teamOpts = (teams.length > 0 ? teams : ["Time A", "Time B"]).map(t => `<option value="${t}">${t}</option>`).join("");
  leftSel.innerHTML = teamOpts;
  rightSel.innerHTML = teamOpts;
  if (rightSel.options.length > 1) rightSel.selectedIndex = 1;

  if (teams.length === 0) {
    container.innerHTML = `<p class="muted-text">Os times ainda não foram sorteados. O organizador pode sortear acima.</p>`;
    return;
  }

  const isStaff = d.myRole >= 1 && d.status !== 2;

  container.innerHTML = teams.map(team => {
    const players = mainPlayers.filter(p => p.teamAssigned === team);
    const totalStars = players.reduce((acc, p) => acc + p.skillRank, 0);

    return `
      <div class="team-box">
        <div class="card-top">
          <h4>${team}</h4>
          <span class="badge-neon">${totalStars}★</span>
        </div>
        ${players.map(p => `
          <div class="team-player-row">
            <span>${p.displayName} ${p.isGoalkeeper ? "🧤" : ""} (${p.skillRank}★)</span>
            ${isStaff ? `
              <select class="mini-select" onchange="movePlayerTeam('${p.id}', this.value)">
                ${teams.map(t => `<option value="${t}" ${t === team ? "selected" : ""}>${t}</option>`).join("")}
              </select>
            ` : ""}
          </div>
        `).join("")}
      </div>
    `;
  }).join("");
}

async function movePlayerTeam(regId, teamAssigned) {
  try {
    await apiFetch(`/Matches/${state.currentMatchId}/registrations/${regId}/team`, {
      method: "PATCH",
      body: JSON.stringify({ teamAssigned })
    });
    showToast("Jogador trocado de time!");
    await openMatchDetail(state.currentMatchId);
  } catch (err) {
    showToast(err.message, true);
  }
}

// ================= SÚMULA OFICIAL =================
async function createGame() {
  try {
    const payload = {
      title: document.getElementById("game-title").value || "Jogo",
      teamLeft: document.getElementById("game-left").value,
      teamRight: document.getElementById("game-right").value
    };
    await apiFetch(`/Matches/${state.currentMatchId}/games`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    showToast("Jogo adicionado à súmula!");
    await openMatchDetail(state.currentMatchId);
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderSumula(d) {
  const container = document.getElementById("games-list");
  if (d.games.length === 0) {
    container.innerHTML = `<p class="muted-text">Nenhum jogo registrado na súmula desta pelada.</p>`;
    return;
  }

  const isStaff = d.myRole >= 1 && !d.isSumulaValidated;
  const players = d.registrations.filter(r => !r.isWaitlist);
  const playerOpts = players.map(p => `<option value="${p.id}">${p.displayName}</option>`).join("");

  container.innerHTML = d.games.map(g => `
    <div class="game-card">
      <div class="scoreboard">
        <span>${g.teamLeft}</span>
        <strong class="neon-text">${g.scoreLeft} x ${g.scoreRight}</strong>
        <span>${g.teamRight}</span>
      </div>
      <div class="goals-feed">
        ${g.goals.map(gl => `
          <div class="goal-line">⚽ <strong>${gl.scorerName}</strong> (${gl.teamName}) ${gl.assistName ? `• 👟 Assist: ${gl.assistName}` : ""}</div>
        `).join("")}
      </div>
      ${isStaff ? `
        <div class="goal-form">
          <select id="goal-team-${g.id}">
            <option value="${g.teamLeft}">${g.teamLeft}</option>
            <option value="${g.teamRight}">${g.teamRight}</option>
          </select>
          <select id="goal-scorer-${g.id}">${playerOpts}</select>
          <select id="goal-assist-${g.id}">
            <option value="">Sem assistência</option>
            ${playerOpts}
          </select>
          <button class="btn-secondary btn-sm" onclick="addGoal('${g.id}')">+ Gol</button>
        </div>
      ` : ""}
    </div>
  `).join("");
}

async function addGoal(gameId) {
  try {
    const assistVal = document.getElementById(`goal-assist-${gameId}`).value;
    const payload = {
      teamName: document.getElementById(`goal-team-${gameId}`).value,
      scorerRegistrationId: document.getElementById(`goal-scorer-${gameId}`).value,
      assistRegistrationId: assistVal || null
    };
    await apiFetch(`/Matches/${state.currentMatchId}/games/${gameId}/goals`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    showToast("Gol registrado!");
    await openMatchDetail(state.currentMatchId);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function validateSumula() {
  try {
    const res = await apiFetch(`/Matches/${state.currentMatchId}/validate-sumula`, { method: "POST" });
    showToast(res.message);
    await selectClub(state.currentClubId);
  } catch (err) {
    showToast(err.message, true);
  }
}

// ================= RANKINGS & LOCAIS =================
function renderRankingsList(rankings) {
  const container = document.getElementById("rankings-list");
  if (rankings.length === 0) {
    container.innerHTML = `<p class="muted-text">Sem estatísticas validadas ainda.</p>`;
    return;
  }
  container.innerHTML = rankings.map((r, idx) => `
    <div class="list-item">
      <div>
        <strong>#${idx + 1} ${r.fullName}</strong>
        <div class="muted-text" style="font-size:0.82rem;">${r.position} • ${r.matches} jogos validados</div>
      </div>
      <div style="display:flex; gap:12px; align-items:center;">
        <span class="badge-neon">⚽ ${r.goals} Gols</span>
        <span class="badge-titanium">👟 ${r.assists} Assist.</span>
      </div>
    </div>
  `).join("");
}

async function loadVenues() {
  state.venues = await apiFetch("/Venues");
  renderVenues(state.venues);
}

function filterVenuesList() {
  const term = document.getElementById("venue-search").value.toLowerCase().trim();
  const filtered = state.venues.filter(v =>
    v.name.toLowerCase().includes(term) || v.address.toLowerCase().includes(term)
  );
  renderVenues(filtered);
}

function renderVenues(list) {
  const container = document.getElementById("venues-list");
  document.getElementById("venues-count").textContent = `${list.length} locais`;
  if (list.length === 0) {
    container.innerHTML = `<p class="muted-text">Nenhuma arena encontrada.</p>`;
    return;
  }
  container.innerHTML = list.map(v => `
    <div class="list-item">
      <div>
        <strong>${v.name}</strong>
        <div class="muted-text" style="font-size:0.82rem;">${v.address}</div>
      </div>
      <span class="mono-tag">${v.defaultPrice ? formatMoney(v.defaultPrice) : "Sob consulta"}</span>
    </div>
  `).join("");
}

async function handleCreateVenue(e) {
  e.preventDefault();
  try {
    const priceRaw = document.getElementById("venue-price").value;
    const payload = {
      name: document.getElementById("venue-name").value,
      address: document.getElementById("venue-address").value,
      defaultPrice: priceRaw ? Number(priceRaw) : null
    };
    await apiFetch("/Venues", { method: "POST", body: JSON.stringify(payload) });
    document.getElementById("venue-name").value = "";
    document.getElementById("venue-address").value = "";
    document.getElementById("venue-price").value = "";
    showToast("Quadra salva com sucesso!");
    await loadVenues();
  } catch (err) {
    showToast(err.message, true);
  }
}