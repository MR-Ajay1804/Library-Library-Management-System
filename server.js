const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(__dirname, "data.json");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const seedData = {
  books: [
    {
      id: crypto.randomUUID(),
      title: "Database Management Systems",
      author: "Raghu Ramakrishnan",
      category: "Computer Science",
      copies: 5,
      available: 5,
    },
    {
      id: crypto.randomUUID(),
      title: "A Brief History of Time",
      author: "Stephen Hawking",
      category: "Science",
      copies: 3,
      available: 3,
    },
    {
      id: crypto.randomUUID(),
      title: "Discrete Mathematics",
      author: "Kenneth Rosen",
      category: "Mathematics",
      copies: 4,
      available: 4,
    },
  ],
  members: [
    {
      id: "LIB1001",
      name: "Ananya Sharma",
      department: "BCA 2nd Year",
      createdAt: new Date().toISOString(),
    },
    {
      id: "LIB1002",
      name: "Rahul Verma",
      department: "BSc Computer Science",
      createdAt: new Date().toISOString(),
    },
  ],
  issues: [],
};

ensureDataFile();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    serveStaticFile(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { message: "Server error.", detail: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Library Management backend running at http://localhost:${PORT}`);
});

async function handleApi(request, response, url) {
  const data = readData();

  if (request.method === "GET" && url.pathname === "/api/library") {
    sendJson(response, 200, data);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/books") {
    const body = await readBody(request);
    const copies = Number(body.copies);
    const title = String(body.title || "").trim();
    const author = String(body.author || "").trim();
    const category = String(body.category || "").trim();

    if (!title || !author || !category || !Number.isInteger(copies) || copies < 1) {
      sendJson(response, 400, { message: "Please fill all book details correctly." });
      return;
    }

    const book = {
      id: crypto.randomUUID(),
      title,
      author,
      category,
      copies,
      available: copies,
    };

    data.books.push(book);
    writeData(data);
    sendJson(response, 201, book);
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/books/")) {
    const bookId = decodeURIComponent(url.pathname.split("/").pop());
    const hasActiveIssue = data.issues.some((issue) => issue.bookId === bookId && !issue.returned);

    if (hasActiveIssue) {
      sendJson(response, 409, { message: "Return this book before removing it." });
      return;
    }

    data.books = data.books.filter((book) => book.id !== bookId);
    writeData(data);
    sendJson(response, 200, { message: "Book removed." });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/members") {
    const body = await readBody(request);
    const id = normalizeMemberId(body.id);
    const name = String(body.name || "").trim();
    const department = String(body.department || "").trim();

    if (!id || !name || !department) {
      sendJson(response, 400, { message: "Please fill all member details." });
      return;
    }

    if (!isValidMemberId(id)) {
      sendJson(response, 400, { message: "Member ID can use 3-20 letters, numbers, or hyphen only." });
      return;
    }

    if (data.members.some((member) => normalizeMemberId(member.id) === id)) {
      sendJson(response, 409, { message: "Member ID already registered. Please use a unique Member ID." });
      return;
    }

    const member = {
      id,
      name,
      department,
      createdAt: new Date().toISOString(),
    };

    data.members.push(member);
    writeData(data);
    sendJson(response, 201, member);
    return;
  }

  if (request.method === "PATCH" && url.pathname.startsWith("/api/members/")) {
    const originalId = normalizeMemberId(decodeURIComponent(url.pathname.split("/").pop()));
    const body = await readBody(request);
    const nextId = normalizeMemberId(body.id);
    const name = String(body.name || "").trim();
    const department = String(body.department || "").trim();
    const member = data.members.find((item) => normalizeMemberId(item.id) === originalId);

    if (!member) {
      sendJson(response, 404, { message: "Member record not found." });
      return;
    }

    if (!nextId || !name || !department) {
      sendJson(response, 400, { message: "Please fill all member details." });
      return;
    }

    if (!isValidMemberId(nextId)) {
      sendJson(response, 400, { message: "Member ID can use 3-20 letters, numbers, or hyphen only." });
      return;
    }

    const duplicateMember = data.members.some((item) => {
      const existingId = normalizeMemberId(item.id);
      return existingId === nextId && existingId !== originalId;
    });

    if (duplicateMember) {
      sendJson(response, 409, { message: "Member ID already registered. Please use a unique Member ID." });
      return;
    }

    member.id = nextId;
    member.name = name;
    member.department = department;
    member.updatedAt = new Date().toISOString();

    data.issues.forEach((issue) => {
      if (normalizeMemberId(issue.memberId) === originalId) {
        issue.memberId = nextId;
      }
    });

    writeData(data);
    sendJson(response, 200, member);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/issues") {
    const body = await readBody(request);
    const book = data.books.find((item) => item.id === body.bookId);
    const memberId = normalizeMemberId(body.memberId);
    const member = data.members.find((item) => normalizeMemberId(item.id) === memberId);

    if (!book || !member || !body.dueDate) {
      sendJson(response, 400, { message: "Please select a valid book, member, and due date." });
      return;
    }

    if (isPastDate(body.dueDate)) {
      sendJson(response, 400, { message: "Due date cannot be before today." });
      return;
    }

    if (book.available < 1) {
      sendJson(response, 409, { message: "This book is not available right now." });
      return;
    }

    const issue = {
      id: crypto.randomUUID(),
      bookId: book.id,
      memberId: member.id,
      dueDate: body.dueDate,
      returned: false,
      issuedAt: new Date().toISOString(),
      returnedAt: null,
    };

    book.available -= 1;
    data.issues.push(issue);
    writeData(data);
    sendJson(response, 201, issue);
    return;
  }

  if (request.method === "PATCH" && url.pathname.endsWith("/return")) {
    const issueId = decodeURIComponent(url.pathname.split("/").at(-2));
    const issue = data.issues.find((item) => item.id === issueId);
    const book = data.books.find((item) => item.id === issue?.bookId);

    if (!issue) {
      sendJson(response, 404, { message: "Issue record not found." });
      return;
    }

    if (!issue.returned) {
      issue.returned = true;
      issue.returnedAt = new Date().toISOString();
      if (book) book.available = clamp(book.available + 1, 0, book.copies);
    }

    writeData(data);
    sendJson(response, 200, issue);
    return;
  }

  sendJson(response, 404, { message: "API route not found." });
}

function serveStaticFile(response, urlPath) {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(__dirname, safePath));

  if (!filePath.startsWith(__dirname)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(response, 404, "Not found");
      return;
    }

    const ext = path.extname(filePath);
    response.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    response.end(content);
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    writeData(seedData);
  }
}

function readData() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  return normalizeData(data);
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function normalizeData(data) {
  data.books = Array.isArray(data.books) ? data.books : [];
  data.members = Array.isArray(data.members) ? data.members : [];
  data.issues = Array.isArray(data.issues) ? data.issues : [];

  data.members = data.members.map((member) => ({
    ...member,
    id: normalizeMemberId(member.id),
    name: String(member.name || "").trim(),
    department: String(member.department || "").trim(),
  }));

  data.books = data.books.map((book) => {
    const copies = Math.max(1, Number(book.copies) || 1);
    return {
      ...book,
      title: String(book.title || "").trim(),
      author: String(book.author || "").trim(),
      category: String(book.category || "").trim(),
      copies,
      available: clamp(Number(book.available) || 0, 0, copies),
    };
  });

  data.issues = data.issues.map((issue) => ({
    ...issue,
    memberId: normalizeMemberId(issue.memberId),
    returned: issue.returned === true || issue.returned === "true",
  }));

  data.books.forEach((book) => {
    const activeCount = data.issues.filter((issue) => issue.bookId === book.id && !issue.returned).length;
    book.available = clamp(book.copies - activeCount, 0, book.copies);
  });

  return data;
}

function normalizeMemberId(id) {
  return String(id || "").trim().toUpperCase().replace(/\s+/g, "");
}

function isValidMemberId(id) {
  return /^[A-Z0-9-]{3,20}$/.test(id);
}

function isPastDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return true;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(status === 204 ? "" : JSON.stringify(data));
}

function sendText(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}
