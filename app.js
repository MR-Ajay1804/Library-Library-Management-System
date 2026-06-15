const API_BASE = location.protocol === "file:" ? "http://localhost:3000" : "";

const state = {
  books: [],
  members: [],
  issues: [],
  search: "",
  category: "all",
  editingMemberId: null,
};

const colors = {
  "Computer Science": "#315f8c",
  Mathematics: "#2f7d5c",
  Science: "#a64f3d",
  Literature: "#7c5b98",
  History: "#8d6b2f",
};

const bookGrid = document.querySelector("#bookGrid");
const issueTable = document.querySelector("#issueTable");
const memberTable = document.querySelector("#memberTable");
const bookSelect = document.querySelector("#bookSelect");
const memberSelect = document.querySelector("#memberSelect");
const emptyStateTemplate = document.querySelector("#emptyStateTemplate");
const overdueFilter = document.querySelector("#overdueFilter");
const notice = document.querySelector("#notice");
const dueDateInput = document.querySelector('input[name="dueDate"]');
const memberForm = document.querySelector("#memberForm");
const memberFormTitle = document.querySelector("#memberFormTitle");
const memberFormHint = document.querySelector("#memberFormHint");
const memberSubmitButton = document.querySelector("#memberSubmitButton");
const cancelMemberEditButton = document.querySelector("#cancelMemberEdit");
let revealObserver;

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
});

document.querySelector("#bookForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  setFormBusy(formElement, true);

  try {
    await apiRequest("/api/books", {
      method: "POST",
      body: {
        title: form.get("title").trim(),
        author: form.get("author").trim(),
        category: form.get("category"),
        copies: Number(form.get("copies")),
      },
    });

    formElement.reset();
    showNotice("Book added successfully.", "success");
    await refreshData();
  } catch (error) {
    const message =
      originalMemberId && error.message === "API route not found."
        ? "Edit member API is not loaded. Restart the backend with npm start, then refresh."
        : error.message;
    showNotice(message, "error");
  } finally {
    setFormBusy(formElement, false);
  }
});

memberForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const memberId = normalizeMemberId(form.get("memberId"));
  const originalMemberId = state.editingMemberId;
  setFormBusy(formElement, true);

  try {
    if (!isValidMemberId(memberId)) {
      formElement.elements.memberId.focus();
      showNotice("Member ID can use 3-20 letters, numbers, or hyphen only.", "error");
      return;
    }

    const duplicateMember = state.members.some((member) => {
      const existingId = normalizeMemberId(member.id);
      return existingId === memberId && existingId !== originalMemberId;
    });

    if (duplicateMember) {
      formElement.elements.memberId.focus();
      showNotice("Member ID already registered. Please use a unique Member ID.", "error");
      return;
    }

    const endpoint = originalMemberId ? `/api/members/${encodeURIComponent(originalMemberId)}` : "/api/members";
    const method = originalMemberId ? "PATCH" : "POST";

    await apiRequest(endpoint, {
      method,
      body: {
        id: memberId,
        name: form.get("name").trim(),
        department: form.get("department").trim(),
      },
    });

    formElement.reset();
    resetMemberFormMode();
    showNotice(originalMemberId ? "Member details updated successfully." : "Member registered successfully.", "success");
    await refreshData();
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    setFormBusy(formElement, false);
  }
});

cancelMemberEditButton.addEventListener("click", () => {
  memberForm.reset();
  resetMemberFormMode();
});

document.querySelector("#issueForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  setFormBusy(formElement, true);

  try {
    if (isPastDate(form.get("dueDate"))) {
      dueDateInput.focus();
      showNotice("Due date cannot be before today.", "error");
      return;
    }

    await apiRequest("/api/issues", {
      method: "POST",
      body: {
        bookId: form.get("bookId"),
        memberId: form.get("memberId"),
        dueDate: form.get("dueDate"),
      },
    });

    formElement.reset();
    setMinimumDueDate();
    showNotice("Book issued successfully.", "success");
    await refreshData();
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    setFormBusy(formElement, false);
  }
});

document.querySelector("#searchInput").addEventListener("input", (event) => {
  state.search = event.target.value.trim().toLowerCase();
  renderBooks();
  renderMemberRecords();
});

document.querySelector("#categoryFilter").addEventListener("change", (event) => {
  state.category = event.target.value;
  renderBooks();
});

overdueFilter?.addEventListener("change", renderIssues);

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = response.status === 204 ? {} : await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

async function refreshData() {
  try {
    const data = await apiRequest("/api/library");
    state.books = data.books || [];
    state.members = data.members || [];
    state.issues = data.issues || [];
    render();
  } catch (error) {
    bookGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-art" aria-hidden="true"><span></span><span></span><span></span></div>
        <p>Backend is not running. Start the server and open http://localhost:3000</p>
      </div>
    `;
    showNotice("Backend is not running. Start the server first.", "error");
  }
}

function render() {
  renderStats();
  renderBooks();
  renderIssueOptions();
  renderMemberRecords();
  renderIssues();
  refreshRevealTargets();
}

function renderStats() {
  const totalCopies = state.books.reduce((sum, book) => sum + Number(book.copies || 0), 0);
  const available = state.books.reduce((sum, book) => sum + Number(book.available || 0), 0);
  const activeIssues = state.issues.filter((issue) => !issue.returned).length;
  const overdueIssues = state.issues.filter((issue) => isOverdue(issue)).length;
  const depositedIssues = state.issues.filter((issue) => issue.returned).length;

  document.querySelector("#totalBooks").textContent = totalCopies;
  document.querySelector("#availableBooks").textContent = available;
  document.querySelector("#totalMembers").textContent = state.members.length;
  document.querySelector("#issuedBooks").textContent = activeIssues;
  document.querySelector("#overdueBooks").textContent = overdueIssues;
  document.querySelector("#depositedBooks").textContent = depositedIssues;
}

function renderBooks() {
  const books = state.books.filter((book) => {
    const matchesCategory = state.category === "all" || book.category === state.category;
    const target = `${book.title} ${book.author} ${book.category}`.toLowerCase();
    return matchesCategory && target.includes(state.search);
  });

  bookGrid.innerHTML = "";

  if (!books.length) {
    bookGrid.appendChild(emptyStateTemplate.content.cloneNode(true));
    return;
  }

  books.forEach((book) => {
    const card = document.createElement("article");
    card.className = "book-card";
    card.innerHTML = `
      <div class="book-cover" style="background:${colors[book.category] || "#315f8c"}">
        <span>${getInitials(book.title)}</span>
      </div>
      <div class="book-body">
        <h3>${escapeHtml(book.title)}</h3>
        <p>${escapeHtml(book.author)}</p>
        <span class="pill">${escapeHtml(book.category)}</span>
      </div>
      <div class="book-actions">
        <span>${book.available} of ${book.copies} available</span>
        <button class="remove-btn" type="button" aria-label="Remove ${escapeHtml(book.title)}" data-remove-book="${book.id}">x</button>
      </div>
    `;
    bookGrid.appendChild(card);
  });

  document.querySelectorAll("[data-remove-book]").forEach((button) => {
    button.addEventListener("click", () => removeBook(button.dataset.removeBook));
  });
}

function renderIssueOptions() {
  const availableBooks = state.books.filter((book) => Number(book.available) > 0);
  bookSelect.innerHTML = availableBooks.length
    ? availableBooks.map((book) => `<option value="${book.id}">${escapeHtml(book.title)} (${book.available})</option>`).join("")
    : '<option value="">No books available</option>';

  memberSelect.innerHTML = state.members.length
    ? state.members.map((member) => `<option value="${member.id}">${escapeHtml(member.name)} - ${escapeHtml(member.id)}</option>`).join("")
    : '<option value="">No members registered</option>';
}

function renderMemberRecords() {
  const members = state.members.filter((member) => {
    const target = `${member.name} ${member.id} ${member.department}`.toLowerCase();
    return target.includes(state.search);
  });

  const activeTotal = state.issues.filter((issue) => !issue.returned).length;
  const depositedTotal = state.issues.filter((issue) => issue.returned).length;

  document.querySelector("#memberRecordTotal").textContent = state.members.length;
  document.querySelector("#memberActiveTotal").textContent = activeTotal;
  document.querySelector("#memberDepositTotal").textContent = depositedTotal;

  memberTable.innerHTML = "";

  if (!members.length) {
    memberTable.innerHTML = '<tr><td colspan="7">No registered members found.</td></tr>';
    return;
  }

  members.forEach((member) => {
    const metrics = getMemberMetrics(member.id);
    const currentBooks = metrics.currentBooks.length
      ? metrics.currentBooks.map((title) => `<span class="book-chip">${escapeHtml(title)}</span>`).join("")
      : '<span class="muted-text">No active issue</span>';

    const row = document.createElement("tr");
    row.className = metrics.overdue > 0 ? "row-alert" : "";
    row.innerHTML = `
      <td>
        <div class="member-name">${escapeHtml(member.name)}</div>
        <div class="member-id">${escapeHtml(member.id)}</div>
      </td>
      <td>${escapeHtml(member.department)}</td>
      <td><span class="metric-pill active">${metrics.active}</span></td>
      <td><span class="metric-pill ${metrics.overdue ? "late" : "calm"}">${metrics.overdue}</span></td>
      <td><span class="metric-pill deposited">${metrics.deposited}</span></td>
      <td><div class="chip-list">${currentBooks}</div></td>
      <td><button class="edit-btn" type="button" data-edit-member="${escapeHtml(member.id)}">Edit</button></td>
    `;
    memberTable.appendChild(row);
  });

  document.querySelectorAll("[data-edit-member]").forEach((button) => {
    button.addEventListener("click", () => startMemberEdit(button.dataset.editMember));
  });
}

function renderIssues() {
  const onlyOverdue = overdueFilter?.checked;
  const visibleIssues = state.issues.filter((issue) => {
    if (issue.returned) return false;
    return onlyOverdue ? isOverdue(issue) : true;
  });

  issueTable.innerHTML = "";

  if (!visibleIssues.length) {
    issueTable.innerHTML = `<tr><td colspan="5">${onlyOverdue ? "No overdue books found." : "No books are currently issued."}</td></tr>`;
    return;
  }

  visibleIssues.forEach((issue) => {
    const book = state.books.find((item) => item.id === issue.bookId);
    const member = state.members.find((item) => item.id === issue.memberId);
    const late = isOverdue(issue);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(book?.title || "Removed book")}</td>
      <td>${escapeHtml(member ? `${member.name} (${member.id})` : "Removed member")}</td>
      <td>${formatDate(issue.dueDate)}</td>
      <td><span class="status ${late ? "due" : "ok"}">${late ? "Overdue" : "Issued"}</span></td>
      <td><button class="return-btn" type="button" data-return="${issue.id}">Return</button></td>
    `;
    issueTable.appendChild(row);
  });

  document.querySelectorAll("[data-return]").forEach((button) => {
    button.addEventListener("click", () => returnBook(button.dataset.return));
  });
}

function getMemberMetrics(memberId) {
  const memberIssues = state.issues.filter((issue) => issue.memberId === memberId);
  const activeIssues = memberIssues.filter((issue) => !issue.returned);
  const overdueIssues = activeIssues.filter((issue) => isOverdue(issue));
  const depositedIssues = memberIssues.filter((issue) => issue.returned);
  const currentBooks = activeIssues.map((issue) => {
    const book = state.books.find((item) => item.id === issue.bookId);
    return book?.title || "Removed book";
  });

  return {
    active: activeIssues.length,
    overdue: overdueIssues.length,
    deposited: depositedIssues.length,
    currentBooks,
  };
}

async function removeBook(bookId) {
  try {
    await apiRequest(`/api/books/${bookId}`, { method: "DELETE" });
    showNotice("Book removed.", "success");
    await refreshData();
  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function returnBook(issueId) {
  try {
    await apiRequest(`/api/issues/${issueId}/return`, { method: "PATCH" });
    showNotice("Book deposited successfully.", "success");
    await refreshData();
  } catch (error) {
    showNotice(error.message, "error");
  }
}

function activateTab(tabId) {
  document.querySelectorAll(".tab, .tab-panel").forEach((item) => item.classList.remove("active"));
  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add("active");
  document.querySelector(`#${tabId}`)?.classList.add("active");
}

function startMemberEdit(memberId) {
  const normalizedId = normalizeMemberId(memberId);
  const member = state.members.find((item) => normalizeMemberId(item.id) === normalizedId);

  if (!member) {
    showNotice("Member record not found.", "error");
    return;
  }

  state.editingMemberId = normalizedId;
  memberForm.elements.name.value = member.name;
  memberForm.elements.memberId.value = member.id;
  memberForm.elements.department.value = member.department;
  memberFormTitle.textContent = "Edit Member";
  memberFormHint.textContent = "Changing Member ID will update this member's issue history too.";
  memberSubmitButton.textContent = "Save Changes";
  cancelMemberEditButton.hidden = false;
  activateTab("memberForm");
  memberForm.scrollIntoView({ behavior: "smooth", block: "center" });
  memberForm.elements.name.focus();
}

function resetMemberFormMode() {
  state.editingMemberId = null;
  memberFormTitle.textContent = "Add Member";
  memberFormHint.textContent = "Member ID is unique, like a primary key.";
  memberSubmitButton.textContent = "Add Member";
  cancelMemberEditButton.hidden = true;
}

function isOverdue(issue) {
  return !issue.returned && new Date(issue.dueDate) < startOfToday();
}

function getInitials(title) {
  return String(title)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

function formatDate(dateString) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(dateString));
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeMemberId(id) {
  return String(id || "").trim().toUpperCase().replace(/\s+/g, "");
}

function isValidMemberId(id) {
  return /^[A-Z0-9-]{3,20}$/.test(id);
}

function isPastDate(dateString) {
  if (!dateString) return true;

  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return true;

  return date < startOfToday();
}

function setMinimumDueDate() {
  if (!dueDateInput) return;

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  dueDateInput.min = `${yyyy}-${mm}-${dd}`;
}

function setFormBusy(formElement, isBusy) {
  const button = formElement.querySelector('button[type="submit"]');
  if (!button) return;

  button.disabled = isBusy;
  button.classList.toggle("is-loading", isBusy);
}

function showNotice(message, type = "success") {
  if (!notice) {
    return;
  }

  notice.textContent = message;
  notice.className = `notice show ${type}`;

  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => {
    notice.classList.remove("show");
  }, 3400);
}

function setupMotion() {
  if (!("IntersectionObserver" in window)) return;

  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
}

function refreshRevealTargets() {
  const targets = document.querySelectorAll(".stat, .panel, .library-view, .records, .book-card");
  targets.forEach((target) => {
    if (target.dataset.revealReady) return;

    target.dataset.revealReady = "true";
    target.classList.add("reveal");

    if (revealObserver) {
      revealObserver.observe(target);
    } else {
      target.classList.add("is-visible");
    }
  });
}

setupMotion();
setMinimumDueDate();
refreshData();
