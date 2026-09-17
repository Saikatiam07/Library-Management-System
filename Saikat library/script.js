const API_BASE = "http://127.0.0.1:5000/api";

let books = [];
let borrowings = [];
let reservations = [];
let bookRequests = [];
let reportSummary = null;
let recentActivity = [];
let currentUser = null;
let toastTimer = null;
const pendingBookActions = new Set();
let activeStudentPaymentStudent = null;
let libraryPolicy = {
  max_active_borrowings: 5,
  loan_period_days: 15,
  renewal_period_days: 7,
  max_renewals_per_loan: 1,
  fine_per_day: 2
};

const loginModal = document.getElementById("loginModal");
const addBookModal = document.getElementById("addBookModal");
const editBookModal = document.getElementById("editBookModal");
const editStudentModal = document.getElementById("editStudentModal");
const studentSelectModal = document.getElementById("studentSelectModal");
const studentBorrowingsModal = document.getElementById("studentBorrowingsModal");
const studentPaymentsModal = document.getElementById("studentPaymentsModal");
const landingPage = document.getElementById("landingPage");
const mainNavbar = document.getElementById("mainNavbar");
const mainFooter = document.getElementById("mainFooter");
const studentDashboard = document.getElementById("studentDashboard");
const adminDashboard = document.getElementById("adminDashboard");

const SUBCATEGORY_OPTIONS = {
  Comics: ["Marvel", "DC"],
  Programming: ["Python", "JavaScript", "Java", "C / C++", "General"],
  Science: ["Physics", "Chemistry", "Mathematics", "General"],
  Novels: ["Fiction", "Classic", "General"]
};

let studentBrowseCategory = null;
let studentBrowseSubcategory = null;
let editingBookId = null;
let editingStudentId = null;
let selectedStudentId = null;
let pendingIssueBookId = null;

const CATEGORY_META = {
  Comics: { icon: "🦸", blurb: "Marvel & DC universes." },
  Science: { icon: "🔬", blurb: "Physics, Chemistry, Mathematics." },
  Programming: { icon: "💻", blurb: "Python, Java, JavaScript, C/C++." },
  Novels: { icon: "📖", blurb: "Fiction & timeless classics." }
};

const BOOK_COVER_CACHE_KEY = "bookverse-custom-covers-v1";
const bookCoverCache = new Map();
const bookCoverRequests = new Map();
const brandImageCache = new Map();

function loadStoredCoverCache() {
  try {
    const stored = JSON.parse(localStorage.getItem(BOOK_COVER_CACHE_KEY) || "{}");
    Object.entries(stored).forEach(([key, value]) => {
      if (typeof value === "string" && value.startsWith("https://")) bookCoverCache.set(key, value);
    });
  } catch (error) {
    console.warn("Could not read saved book-cover cache:", error);
  }
}

function saveStoredCoverCache() {
  try {
    localStorage.setItem(BOOK_COVER_CACHE_KEY, JSON.stringify(Object.fromEntries(bookCoverCache)));
  } catch (error) {
    console.warn("Could not save book-cover cache:", error);
  }
}

function bookCoverKey(book) {
  return `${String(book.title || "").trim().toLowerCase()}|${String(book.author || "").trim().toLowerCase()}`;
}

function normalizeBookText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fallbackArtworkUrl(book) {
  // Return null since we're using custom SVG covers now
  return null;
}

async function fetchBookCover(book) {
  // Create custom CSS-based comic covers to avoid copyright issues
  return createCustomCover(book);
}

function createCustomCover(book) {
  // Generate custom SVG-based cover with gradients and text
  const colors = {
    "Comics": { primary: "#e63946", secondary: "#1d3557", accent: "#f1faee" },
    "Science": { primary: "#2a9d8f", secondary: "#264653", accent: "#e9c46a" },
    "Programming": { primary: "#e76f51", secondary: "#264653", accent: "#f4a261" },
    "Novels": { primary: "#9b5de5", secondary: "#00bbf9", accent: "#f15bb5" }
  };

  const theme = colors[book.category] || colors["Comics"];
  const titleShort = book.title.length > 20 ? book.title.substring(0, 20) + "..." : book.title;
  const authorShort = book.author.length > 15 ? book.author.substring(0, 15) + "..." : book.author;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
      <defs>
        <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${theme.primary};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${theme.secondary};stop-opacity:1" />
        </linearGradient>
        <linearGradient id="accent-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:${theme.accent};stop-opacity:0.8" />
          <stop offset="100%" style="stop-color:${theme.accent};stop-opacity:0.2" />
        </linearGradient>
      </defs>
      <rect width="300" height="450" fill="url(#bg-gradient)" />
      <rect x="20" y="20" width="260" height="50" fill="url(#accent-gradient)" rx="5" />
      <text x="150" y="55" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="${theme.secondary}" text-anchor="middle">${book.category}</text>
      <text x="150" y="100" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="${theme.accent}" text-anchor="middle">${titleShort}</text>
      <text x="150" y="130" font-family="Arial, sans-serif" font-size="12" fill="${theme.accent}" text-anchor="middle" opacity="0.8">${authorShort}</text>
      <rect x="40" y="160" width="220" height="200" fill="${theme.secondary}" opacity="0.3" rx="10" />
      <text x="150" y="260" font-family="Arial, sans-serif" font-size="48" fill="${theme.accent}" text-anchor="middle" opacity="0.5">${book.icon}</text>
      <rect x="40" y="380" width="220" height="40" fill="${theme.accent}" opacity="0.2" rx="5" />
      <text x="150" y="405" font-family="Arial, sans-serif" font-size="12" fill="${theme.accent}" text-anchor="middle">₹${Number(book.price || 0).toFixed(0)}</text>
    </svg>
  `;

  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function createCategoryBackground(category) {
  const colors = {
    "Comics": { primary: "#e63946", secondary: "#1d3557", accent: "#f1faee" },
    "Science": { primary: "#2a9d8f", secondary: "#264653", accent: "#e9c46a" },
    "Programming": { primary: "#e76f51", secondary: "#264653", accent: "#f4a261" },
    "Novels": { primary: "#9b5de5", secondary: "#00bbf9", accent: "#f15bb5" }
  };

  const theme = colors[category] || colors["Comics"];
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
      <defs>
        <linearGradient id="cat-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${theme.primary};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${theme.secondary};stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="400" height="200" fill="url(#cat-gradient)" />
      <text x="200" y="110" font-family="Arial Black, sans-serif" font-size="48" font-weight="bold" fill="${theme.accent}" text-anchor="middle">${category}</text>
    </svg>
  `;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function getBookCover(book) {
  const key = bookCoverKey(book);
  if (bookCoverCache.has(key)) return Promise.resolve(bookCoverCache.get(key));
  if (bookCoverRequests.has(key)) return bookCoverRequests.get(key);

  const customCover = createCustomCover(book);
  bookCoverCache.set(key, customCover);
  saveStoredCoverCache();

  const request = Promise.resolve(customCover);
  bookCoverRequests.set(key, request);
  return request;
}

function createBookArtwork(book, className = "book-cover") {
  const artwork = document.createElement("div");
  artwork.className = `book-artwork ${className}`;

  const imageUrl = createCustomCover(book);
  const image = document.createElement("img");
  image.src = imageUrl;
  image.alt = `${book.title || "Book"} cover`;
  image.loading = "lazy";
  image.style.width = "100%";
  image.style.height = "100%";
  image.style.objectFit = "cover";

  const fallback = document.createElement("span");
  fallback.className = "artwork-fallback";
  fallback.textContent = book.icon || "📚";

  image.onerror = () => {
    image.remove();
    artwork.appendChild(fallback);
  };

  artwork.appendChild(image);
  return artwork;
}

async function getBrandImage(pageName) {
  if (brandImageCache.has(pageName)) return brandImageCache.get(pageName);

  // Create custom brand logos
  const customLogos = {
    "Marvel_Comics": createMarvelLogo(),
    "DC_Comics": createDCLogo()
  };

  const request = Promise.resolve(customLogos[pageName] || null);
  brandImageCache.set(pageName, request);
  return request;
}

function createMarvelLogo() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
      <defs>
        <linearGradient id="marvel-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#e63946;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#f4a261;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="200" height="100" fill="#1d3557" rx="10" />
      <text x="100" y="65" font-family="Arial Black, sans-serif" font-size="32" font-weight="bold" fill="url(#marvel-gradient)" text-anchor="middle">MARVEL</text>
      <rect x="20" y="75" width="160" height="3" fill="#e63946" rx="1" />
    </svg>
  `;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function createDCLogo() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
      <defs>
        <linearGradient id="dc-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#00bbf9;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#00b4d8;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="200" height="100" fill="#023e8a" rx="10" />
      <circle cx="100" cy="50" r="35" fill="url(#dc-gradient)" />
      <text x="100" y="58" font-family="Arial Black, sans-serif" font-size="28" font-weight="bold" fill="#023e8a" text-anchor="middle">DC</text>
    </svg>
  `;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function createBrandArtwork(pageName, label) {
  const brand = document.createElement("div");
  brand.className = "brand-artwork";
  brand.textContent = label;

  const imageUrl = pageName === "Marvel_Comics" ? createMarvelLogo() :
                  pageName === "DC_Comics" ? createDCLogo() : null;

  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = `${label} logo`;
    image.loading = "lazy";
    image.style.width = "100%";
    image.style.height = "100%";
    image.style.objectFit = "contain";
    image.style.padding = "8px";
    image.onerror = () => image.remove();
    brand.prepend(image);
  }

  return brand;
}

function createCategoryArtwork(category, subcategory = null) {
  const visual = document.createElement("div");
  visual.className = "category-artwork";

  // Comics: Show mixed Marvel and DC logos at category level
  if (category === "Comics" && !subcategory) {
    const marvelBrand = createBrandArtwork("Marvel_Comics", "MARVEL");
    const dcBrand = createBrandArtwork("DC_Comics", "DC");
    visual.append(marvelBrand, dcBrand);
    return visual;
  }

  // Comics subcategories: Show brand logo + custom book covers
  if (category === "Comics" && subcategory === "Marvel") {
    const marvelBrand = createBrandArtwork("Marvel_Comics", "MARVEL");
    marvelBrand.style.width = "50%";
    visual.appendChild(marvelBrand);

    const marvelBooks = books.filter(book => book.category === "Comics" && book.subcategory === "Marvel");
    marvelBooks.slice(0, 2).forEach(book => {
      const bookArt = createBookArtwork(book, "category-book-artwork");
      bookArt.style.width = "25%";
      visual.appendChild(bookArt);
    });

    // If no books, show Marvel icon
    if (marvelBooks.length === 0) {
      const fallback = document.createElement("div");
      fallback.className = "category-book-artwork";
      fallback.style.display = "flex";
      fallback.style.alignItems = "center";
      fallback.style.justifyContent = "center";
      fallback.style.fontSize = "48px";
      fallback.style.width = "50%";
      fallback.textContent = "🦸";
      visual.appendChild(fallback);
    }
    return visual;
  }

  if (category === "Comics" && subcategory === "DC") {
    const dcBrand = createBrandArtwork("DC_Comics", "DC");
    dcBrand.style.width = "50%";
    visual.appendChild(dcBrand);

    const dcBooks = books.filter(book => book.category === "Comics" && book.subcategory === "DC");
    dcBooks.slice(0, 2).forEach(book => {
      const bookArt = createBookArtwork(book, "category-book-artwork");
      bookArt.style.width = "25%";
      visual.appendChild(bookArt);
    });

    // If no books, show DC icon
    if (dcBooks.length === 0) {
      const fallback = document.createElement("div");
      fallback.className = "category-book-artwork";
      fallback.style.display = "flex";
      fallback.style.alignItems = "center";
      fallback.style.justifyContent = "center";
      fallback.style.fontSize = "48px";
      fallback.style.width = "50%";
      fallback.textContent = "🦸";
      visual.appendChild(fallback);
    }
    return visual;
  }

  // Other categories: Show custom book covers
  if (!subcategory) {
    const categoryBooks = books.filter(book => book.category === category);
    categoryBooks.slice(0, 3).forEach(book => {
      visual.appendChild(createBookArtwork(book, "category-book-artwork"));
    });

    if (categoryBooks.length === 0) {
      visual.textContent = CATEGORY_META[category]?.icon || "📚";
    }
    return visual;
  }

  // For subcategories, show book covers from that subcategory
  if (subcategory) {
    const matches = books.filter(book => book.category === category && book.subcategory === subcategory);
    matches.slice(0, 3).forEach(book => visual.appendChild(createBookArtwork(book, "category-book-artwork")));
    if (matches.length === 0) visual.textContent = CATEGORY_META[category]?.icon || "📚";
    return visual;
  }

  // Default fallback
  visual.textContent = CATEGORY_META[category]?.icon || "📚";
  return visual;
}

loadStoredCoverCache();


// ---------------- API HELPERS ----------------

async function fetchBooks() {
  try {
    const response = await fetch(`${API_BASE}/books`);
    books = await response.json();
  } catch (error) {
    console.error("Failed to load books:", error);
    showToast("Could not connect to server.");
  }
}

async function apiAddBook(bookData) {
  const response = await fetch(`${API_BASE}/books`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bookData)
  });
  return response.json();
}

async function apiUpdateBook(bookId, bookData) {
  const response = await fetch(`${API_BASE}/books/${bookId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bookData)
  });
  return response.json();
}

async function apiDeleteBook(bookId) {
  const response = await fetch(`${API_BASE}/books/${bookId}`, { method: "DELETE" });
  return response.json();
}

async function apiImportCatalogueBooks() {
  const response = await fetch(`${API_BASE}/catalogue/import`, { method: "POST" });
  return response.json();
}

async function apiIssueBook(bookId, studentId) {
  const response = await fetch(`${API_BASE}/books/${bookId}/issue`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id: studentId })
  });
  return response.json();
}

async function apiReturnBook(bookId, studentId = null, isAdmin = false) {
  const response = await fetch(`${API_BASE}/books/${bookId}/return`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id: studentId, is_admin: isAdmin })
  });
  return response.json();
}

async function apiReturnBorrowing(borrowingId, studentId) {
  const response = await fetch(`${API_BASE}/borrowings/${borrowingId}/return`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id: studentId })
  });
  return response.json();
}

async function apiRenewBorrowing(borrowingId, studentId) {
  const response = await fetch(`${API_BASE}/borrowings/${borrowingId}/renew`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id: studentId })
  });
  return response.json();
}

async function apiCollectFine(borrowingId, paymentMode = "") {
  const response = await fetch(`${API_BASE}/borrowings/${borrowingId}/fine-payment`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payment_mode: paymentMode })
  });
  return response.json();
}

async function apiRequestFinePayment(borrowingId, studentId, paymentMode) {
  const response = await fetch(`${API_BASE}/borrowings/${borrowingId}/fine-payment-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id: studentId, payment_mode: paymentMode })
  });
  return response.json();
}

async function apiUpdateStudentProfile(studentId, profileData) {
  const response = await fetch(`${API_BASE}/students/${studentId}/profile`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profileData)
  });
  return response.json();
}

async function apiReserveBook(bookId, studentId) {
  const response = await fetch(`${API_BASE}/books/${bookId}/reserve`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id: studentId })
  });
  return response.json();
}

async function apiCancelReservation(reservationId, studentId) {
  const response = await fetch(`${API_BASE}/reservations/${reservationId}/cancel`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id: studentId })
  });
  return response.json();
}

async function apiCreateBookRequest(requestData) {
  const response = await fetch(`${API_BASE}/book-requests`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestData)
  });
  return response.json();
}

async function apiReviewBookRequest(requestId, status, reviewerNote) {
  const response = await fetch(`${API_BASE}/book-requests/${requestId}/review`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, reviewer_note: reviewerNote })
  });
  return response.json();
}

async function fetchStudents() {
  try {
    const response = await fetch(`${API_BASE}/students`);
    return await response.json();
  } catch (error) {
    console.error("Failed to load students:", error);
    return [];
  }
}

async function fetchStudentBorrowings(studentId) {
  try {
    const response = await fetch(`${API_BASE}/students/${studentId}/borrowings`);
    return await response.json();
  } catch (error) {
    console.error("Failed to load student borrowings:", error);
    return [];
  }
}

async function apiEditStudent(studentId, studentData) {
  const response = await fetch(`${API_BASE}/students/${studentId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(studentData)
  });
  return response.json();
}

async function apiDeleteStudent(studentId) {
  const response = await fetch(`${API_BASE}/students/${studentId}`, { method: "DELETE" });
  return response.json();
}


// ---------------- UI HELPERS ----------------

function openLogin() { loginModal.classList.add("active"); showRoleChoice(); }

function closeLogin() {
  loginModal.classList.remove("active");
  document.getElementById("adminErrorMsg").textContent = "";
  document.getElementById("studentErrorMsg").textContent = "";
  document.getElementById("registerErrorMsg").textContent = "";
}

function scrollToDiscover() {
  document.getElementById("discover").scrollIntoView({ behavior: "smooth" });
}

function togglePassword(fieldId, button) {
  const field = document.getElementById(fieldId);
  if (field.type === "password") { field.type = "text"; button.textContent = "Hide"; }
  else { field.type = "password"; button.textContent = "Show"; }
}


// ---------------- LOGIN MODAL VIEW SWITCHING ----------------

function hideAllAuthViews() {
  ["roleChoiceView", "adminLoginView", "studentLoginView", "registerView"]
    .forEach(id => document.getElementById(id).style.display = "none");
}

function showRoleChoice() {
  hideAllAuthViews();
  document.getElementById("roleChoiceView").style.display = "block";
}

function showLoginView(role) {
  hideAllAuthViews();
  const viewId = role === "admin" ? "adminLoginView" : "studentLoginView";
  const fieldId = role === "admin" ? "adminUsername" : "studentUsername";
  document.getElementById(viewId).style.display = "block";
  setTimeout(() => document.getElementById(fieldId).focus(), 100);
}

function showRegisterView(event) {
  if (event) event.preventDefault();
  hideAllAuthViews();
  document.getElementById("registerView").style.display = "block";
  setTimeout(() => document.getElementById("regName").focus(), 100);
}


// ---------------- ADMIN LOGIN ----------------

function handleAdminLogin(event) {
  event.preventDefault();
  const username = document.getElementById("adminUsername").value.trim();
  const password = document.getElementById("adminPassword").value.trim();
  const error = document.getElementById("adminErrorMsg");

  if (!username || !password) { error.textContent = "Please enter both username and password."; return; }

  if (username === "admin" && password === "1234") {
    error.textContent = "";
    currentUser = { username: "Admin", role: "Admin" };
    showAdminDashboard();
    return;
  }
  error.textContent = "Invalid admin username or password.";
}


// ---------------- STUDENT LOGIN ----------------

async function handleStudentLogin(event) {
  event.preventDefault();
  const username = document.getElementById("studentUsername").value.trim();
  const password = document.getElementById("studentPassword").value.trim();
  const error = document.getElementById("studentErrorMsg");

  if (!username || !password) { error.textContent = "Please enter both username and password."; return; }

  try {
    const response = await fetch(`${API_BASE}/student-login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const result = await response.json();

    if (result.success) {
      error.textContent = "";
      currentUser = {
        id: result.student.id,
        name: result.student.name,
        username: result.student.username,
        roll_number: result.student.roll_number,
        phone: result.student.phone,
        course: result.student.course,
        semester: result.student.semester,
        role: "Student"
      };
      showStudentDashboard();
      return;
    }
    error.textContent = result.message || "Invalid username or password.";
  } catch (err) {
    console.error("Login failed:", err);
    error.textContent = "Could not connect to server.";
  }
}


// ---------------- STUDENT REGISTRATION ----------------

async function handleRegister(event) {
  event.preventDefault();
  const name = document.getElementById("regName").value.trim();
  const username = document.getElementById("regUsername").value.trim();
  const password = document.getElementById("regPassword").value.trim();
  const error = document.getElementById("registerErrorMsg");

  if (!name || !username || !password) { error.textContent = "Please fill all fields."; return; }

  try {
    const response = await fetch(`${API_BASE}/students`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, username, password })
    });
    const result = await response.json();

    if (!result.success) { error.textContent = result.message; return; }

    error.textContent = "";
    document.getElementById("regName").value = "";
    document.getElementById("regUsername").value = "";
    document.getElementById("regPassword").value = "";
    showToast("Account created! You can now sign in.");
    showLoginView("student");
  } catch (err) {
    console.error("Register failed:", err);
    error.textContent = "Something went wrong. Try again.";
  }
}


// ---------------- DASHBOARDS ----------------

function hideMainWebsite() {
  landingPage.style.display = "none";
  mainNavbar.style.display = "none";
  mainFooter.style.display = "none";
}

async function showAdminDashboard() {
  closeLogin();
  hideMainWebsite();
  studentDashboard.classList.remove("active-app");
  adminDashboard.classList.add("active-app");

  await Promise.all([fetchBooks(), fetchBorrowings(), fetchReservations(), fetchBookRequests(), fetchReportSummary(), fetchRecentActivity(), fetchLibraryPolicy()]);
  updateAdminStats();
  renderAdminReportSummary();
  renderAdminBooks();
  renderRecentBooks();
  renderIssuedBooks();
  renderReservationQueue();
  renderRecentActivity();
  renderAdminBookRequests();
  window.scrollTo({ top: 0, behavior: "instant" });
}

async function showStudentDashboard() {
  closeLogin();
  hideMainWebsite();
  adminDashboard.classList.remove("active-app");
  studentDashboard.classList.add("active-app");

  populateStudentProfile();

  await Promise.all([fetchBooks(), fetchBorrowings(), fetchReservations(currentUser.id), fetchBookRequests(currentUser.id), fetchLibraryPolicy()]);
  updateStudentStats();
  renderStudentRules();
  renderStudentBooks();
  renderRecommendedBooks();
  renderMyBooks();
  renderMyReservations();
  renderStudentPayments();
  renderStudentBookRequests();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function handleLogout() {
  currentUser = null;
  studentBrowseCategory = null;
  studentBrowseSubcategory = null;
  studentDashboard.classList.remove("active-app");
  adminDashboard.classList.remove("active-app");
  landingPage.style.display = "block";
  mainNavbar.style.display = "flex";
  mainFooter.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showStudentSection(sectionId, clickedButton) {
  document.querySelectorAll("#studentDashboard .dashboard-section")
    .forEach(s => s.classList.remove("active-section"));

  const selected = document.getElementById(sectionId);
  if (!selected) return;
  selected.classList.add("active-section");

  document.querySelectorAll("#studentDashboard .side-link")
    .forEach(b => b.classList.remove("active"));
  if (clickedButton) clickedButton.classList.add("active");

  if (sectionId === "studentBooks") renderStudentBooks();
  if (sectionId === "myBooks") renderMyBooks();
  if (sectionId === "myReservations") renderMyReservations();
  if (sectionId === "studentPayments") renderStudentPayments();
  if (sectionId === "studentBookRequests") refreshStudentBookRequests();
  if (sectionId === "studentProfile") populateStudentProfile();
}

function populateStudentProfile() {
  if (!currentUser) return;
  document.getElementById("studentWelcome").textContent = "Welcome, " + currentUser.name + "!";
  document.getElementById("profileName").textContent = currentUser.name;
  document.getElementById("profileUsername").textContent = currentUser.username;
  document.getElementById("profileRollNumber").textContent = currentUser.roll_number || "Not added";

  const fields = {
    profileFullName: currentUser.name || "",
    profileRollInput: currentUser.roll_number || "",
    profilePhone: currentUser.phone || "",
    profileCourse: currentUser.course || "",
    profileSemester: currentUser.semester || ""
  };
  Object.entries(fields).forEach(([id, value]) => {
    const field = document.getElementById(id);
    if (field) field.value = value;
  });
}

async function handleProfileUpdate(event) {
  event.preventDefault();
  if (!currentUser || currentUser.role !== "Student") return;

  const profileData = {
    name: document.getElementById("profileFullName").value.trim(),
    roll_number: document.getElementById("profileRollInput").value.trim(),
    phone: document.getElementById("profilePhone").value.trim(),
    course: document.getElementById("profileCourse").value.trim(),
    semester: document.getElementById("profileSemester").value
  };

  try {
    const result = await apiUpdateStudentProfile(currentUser.id, profileData);
    showToast(result.message);
    if (!result.success) return;

    currentUser = { ...currentUser, ...result.student, role: "Student" };
    populateStudentProfile();
  } catch (error) {
    console.error("Profile update failed:", error);
    showToast("Could not update your profile. Please try again.");
  }
}

function showAdminSection(sectionId, clickedButton) {
  document.querySelectorAll("#adminDashboard .dashboard-section")
    .forEach(s => s.classList.remove("active-section"));

  const selected = document.getElementById(sectionId);
  if (!selected) return;
  selected.classList.add("active-section");

  document.querySelectorAll("#adminDashboard .side-link")
    .forEach(b => b.classList.remove("active"));
  if (clickedButton) clickedButton.classList.add("active");

  if (sectionId === "manageBooks") renderAdminBooks();
  if (sectionId === "adminOverview") { updateAdminStats(); renderAdminReportSummary(); renderRecentBooks(); renderIssuedBooks(); renderReservationQueue(); renderRecentActivity(); }
  if (sectionId === "manageStudents") renderStudents();
  if (sectionId === "manageBookRequests") refreshAdminBookRequests();
  if (sectionId === "loanHistory") refreshLoanHistory();
}


// ---------------- STATS ----------------

function isCurrentStudentsBook(book) {
  if (!currentUser || currentUser.role !== "Student") return false;
  return borrowings.some(loan =>
    loan.book_id === book.id && loan.student_id === currentUser.id && !loan.returned_at
  );
}

function getCurrentStudentsBorrowingsForBook(bookId) {
  if (!currentUser || currentUser.role !== "Student") return [];
  return borrowings.filter(loan =>
    loan.book_id === bookId && loan.student_id === currentUser.id && !loan.returned_at
  );
}

function getCurrentStudentsReservation(bookId) {
  if (!currentUser || currentUser.role !== "Student") return null;
  return reservations.find(reservation =>
    reservation.book_id === bookId && reservation.student_id === currentUser.id
  ) || null;
}

async function fetchReservations(studentId = null) {
  try {
    const query = studentId ? `?student_id=${encodeURIComponent(studentId)}` : "";
    const response = await fetch(`${API_BASE}/reservations${query}`);
    reservations = await response.json();
  } catch (error) {
    console.error("Failed to load reservations:", error);
    reservations = [];
  }
}

async function fetchBookRequests(studentId = null) {
  try {
    const query = studentId ? `?student_id=${encodeURIComponent(studentId)}` : "";
    const response = await fetch(`${API_BASE}/book-requests${query}`);
    bookRequests = await response.json();
  } catch (error) {
    console.error("Failed to load book requests:", error);
    bookRequests = [];
  }
}

async function fetchBorrowings() {
  try {
    const response = await fetch(`${API_BASE}/borrowings`);
    borrowings = await response.json();
  } catch (error) {
    console.error("Failed to load borrowing history:", error);
    borrowings = [];
  }
}

async function fetchLibraryPolicy() {
  try {
    const response = await fetch(`${API_BASE}/library-policy`);
    if (!response.ok) return;
    const policy = await response.json();
    libraryPolicy = { ...libraryPolicy, ...policy };
  } catch (error) {
    console.warn("Could not load library policy; using default rules.", error);
  }
}

async function fetchReportSummary() {
  try {
    const response = await fetch(`${API_BASE}/reports/summary`);
    reportSummary = await response.json();
  } catch (error) {
    console.error("Failed to load reports:", error);
    reportSummary = null;
  }
}

async function fetchRecentActivity() {
  try {
    const response = await fetch(`${API_BASE}/activity`);
    recentActivity = await response.json();
  } catch (error) {
    console.error("Failed to load recent activity:", error);
    recentActivity = [];
  }
}

function updateStudentStats() {
  document.getElementById("studentTotalBooks").textContent = books.length;
  const activeBorrowings = getCurrentStudentActiveBorrowingCount();
  document.getElementById("studentBorrowedBooks").textContent =
    `${activeBorrowings}/${libraryPolicy.max_active_borrowings}`;
  const reservedElement = document.getElementById("studentReservedBooks");
  if (reservedElement) reservedElement.textContent = reservations.length;
  renderStudentOverdueAlert();
}

function renderStudentRules() {
  const ruleValues = {
    ruleBorrowLimit: libraryPolicy.max_active_borrowings,
    ruleLoanDays: libraryPolicy.loan_period_days,
    ruleRenewalDays: libraryPolicy.renewal_period_days,
    ruleFineAmount: libraryPolicy.fine_per_day
  };
  Object.entries(ruleValues).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });
}

function getCurrentStudentActiveBorrowingCount() {
  if (!currentUser || currentUser.role !== "Student") return 0;
  return borrowings.filter(loan => loan.student_id === currentUser.id && !loan.returned_at).length;
}

function hasReachedBorrowingLimit() {
  return getCurrentStudentActiveBorrowingCount() >= Number(libraryPolicy.max_active_borrowings || 5);
}

function updateAdminStats() {
  document.getElementById("adminTotalBooks").textContent = books.length;
  document.getElementById("adminAvailableBooks").textContent =
    books.reduce((total, book) => total + Number(book.available_copies ?? 0), 0);
  document.getElementById("adminIssuedBooks").textContent =
    borrowings.filter(loan => !loan.returned_at).length;
  const overdueElement = document.getElementById("adminOverdueBooks");
  if (overdueElement) overdueElement.textContent = borrowings.filter(loan => !loan.returned_at && loan.is_overdue).length;
  renderAdminOverdueAlerts();
  renderAdminFineCollections();
}

function isPastDue(value) {
  if (!value) return false;
  const dueDate = new Date(`${value}T23:59:59`);
  return !Number.isNaN(dueDate.getTime()) && dueDate < new Date();
}

function getOverdueBorrowings() {
  return borrowings.filter(loan => !loan.returned_at && Boolean(loan.is_overdue));
}

function renderStudentOverdueAlert() {
  const container = document.getElementById("studentOverdueAlert");
  if (!container || !currentUser || currentUser.role !== "Student") return;
  const overdueLoans = getOverdueBorrowings().filter(loan => loan.student_id === currentUser.id);

  if (overdueLoans.length === 0) {
    container.className = "student-overdue-alert";
    container.innerHTML = "";
    return;
  }

  const totalFine = overdueLoans.reduce((total, loan) => total + Number(loan.fine_amount || 0), 0);
  const bookNames = overdueLoans.slice(0, 2).map(loan => escapeHtml(loan.title)).join(", ");
  const extraText = overdueLoans.length > 2 ? ` and ${overdueLoans.length - 2} more` : "";
  container.className = "student-overdue-alert active";
  container.innerHTML = `<div><strong>⚠️ ${overdueLoans.length} overdue book${overdueLoans.length === 1 ? "" : "s"}</strong><p>${bookNames}${extraText}. Return the book${overdueLoans.length === 1 ? "" : "s"} as soon as possible. Current fine: ₹${totalFine.toFixed(0)}.</p></div><button type="button" class="action-button" onclick="showStudentSection('myBooks')">View My Books</button>`;
}

function renderAdminOverdueAlerts() {
  const container = document.getElementById("adminOverdueAlertsList");
  const totalElement = document.getElementById("adminOverdueStudentCount");
  if (!container || !totalElement) return;
  const overdueLoans = getOverdueBorrowings().sort((first, second) => Number(second.overdue_days || 0) - Number(first.overdue_days || 0));
  const uniqueStudents = new Set(overdueLoans.map(loan => loan.student_id || loan.student_name || loan.borrower_name));
  totalElement.textContent = `${overdueLoans.length} overdue`;

  if (overdueLoans.length === 0) {
    container.innerHTML = `<p class="admin-panel-empty">No overdue books. All active loans are within their due date.</p>`;
    return;
  }

  container.innerHTML = "";
  overdueLoans.slice(0, 6).forEach(loan => {
    const row = document.createElement("div");
    row.className = "admin-book-row overdue-admin-row";
    const fine = Number(loan.fine_amount || 0);
    row.innerHTML = `<span class="alert-icon">⚠️</span><div><h3>${escapeHtml(loan.student_name || loan.borrower_name || "Unknown student")}</h3><p>${escapeHtml(loan.title)} • Due ${formatDate(loan.due_date)}</p><p class="overdue-text">${Number(loan.overdue_days || 0)} day${Number(loan.overdue_days || 0) === 1 ? "" : "s"} late • Current fine ₹${fine.toFixed(0)}</p></div><small>Overdue</small>`;
    container.appendChild(row);
  });
  if (overdueLoans.length > 6) {
    const more = document.createElement("p");
    more.className = "admin-panel-empty";
    more.textContent = `${overdueLoans.length - 6} more overdue loan${overdueLoans.length - 6 === 1 ? "" : "s"} shown in Loan History.`;
    container.appendChild(more);
  }
  if (uniqueStudents.size === 0) totalElement.textContent = "0 overdue";
}

function renderAdminFineCollections() {
  const container = document.getElementById("adminFineCollectionsList");
  const totalElement = document.getElementById("adminFineCollectedTotal");
  if (!container || !totalElement) return;
  const paidLoans = borrowings
    .filter(loan => loan.fine_payment_status === "Paid" && Number(loan.fine_paid_amount || 0) > 0)
    .sort((first, second) => new Date(second.fine_paid_at || 0) - new Date(first.fine_paid_at || 0));
  const totalCollected = paidLoans.reduce((total, loan) => total + Number(loan.fine_paid_amount || 0), 0);
  totalElement.textContent = `₹${totalCollected.toFixed(0)} collected`;

  if (paidLoans.length === 0) {
    container.innerHTML = `<p class="admin-panel-empty">No fine payments have been confirmed yet.</p>`;
    return;
  }

  container.innerHTML = "";
  paidLoans.slice(0, 6).forEach(loan => {
    const row = document.createElement("div");
    row.className = "admin-book-row fine-collection-row";
    const amount = Number(loan.fine_paid_amount || 0);
    row.innerHTML = `<span class="collection-icon">₹</span><div><h3>${escapeHtml(loan.student_name || loan.borrower_name || "Unknown student")} paid ₹${amount.toFixed(0)}</h3><p>${escapeHtml(loan.title)} • ${escapeHtml(loan.fine_payment_mode || "Cash")} • ${formatDateTime(loan.fine_paid_at)}</p><p class="receipt-row">${escapeHtml(loan.fine_receipt_number || "Receipt pending")}</p></div><small>Paid</small>`;
    container.appendChild(row);
  });
}


// ---------------- RENDER: STUDENT ----------------

function renderRecommendedBooks() {
  const container = document.getElementById("recommendedBooks");
  container.innerHTML = "";
  books.slice(0, 4).forEach(book => {
    const item = document.createElement("div");
    item.className = "mini-book";
    const details = document.createElement("div");
    details.innerHTML = `<h3>${book.title}</h3><p>${book.author}</p>`;
    item.append(createBookArtwork(book, "book-cover"), details);
    container.appendChild(item);
  });
}

function renderStudentBooks() {
  const container = document.getElementById("studentBookGrid");
  const search = document.getElementById("studentSearch").value.trim().toLowerCase();
  container.className = "";
  container.innerHTML = "";

  if (search) {
    renderStudentSearchResults(container, search);
  } else if (!studentBrowseCategory) {
    renderBrowseCategories(container);
  } else if (!studentBrowseSubcategory) {
    renderBrowseSubcategories(container, studentBrowseCategory);
  } else {
    renderBrowseBooks(container, studentBrowseCategory, studentBrowseSubcategory);
  }
}

function renderStudentSearchResults(container, search) {
  container.className = "large-book-grid";
  const filtered = books.filter(b =>
    b.title.toLowerCase().includes(search) || b.author.toLowerCase().includes(search) ||
    String(b.id).toLowerCase().includes(search) || b.category.toLowerCase().includes(search) ||
    (b.subcategory || "").toLowerCase().includes(search)
  );
  if (filtered.length === 0) {
    container.innerHTML = `<div class="dashboard-panel"><h3>No books found</h3><p style="color:var(--muted);margin-top:8px;">Try another title, author or category.</p></div>`;
    return;
  }
  filtered.forEach(book => container.appendChild(buildBookCard(book)));
}

function renderBrowseCategories(container) {
  const heading = document.createElement("p");
  heading.className = "browse-heading";
  heading.textContent = "Tap a category to explore the collection.";
  container.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "category-grid";
  Object.keys(CATEGORY_META).forEach(category => {
    const meta = CATEGORY_META[category];
    const count = books.filter(b => b.category === category).length;
    const card = document.createElement("div");
    card.className = "category-card browse-card";
    card.onclick = () => { studentBrowseCategory = category; studentBrowseSubcategory = null; renderStudentBooks(); };
    card.append(createCategoryArtwork(category));
    card.insertAdjacentHTML("beforeend", `<h3>${category}</h3><p>${meta.blurb}</p><span class="browse-count">${count} book${count === 1 ? "" : "s"}</span>`);
    grid.appendChild(card);
  });
  container.appendChild(grid);
}

function renderBrowseSubcategories(container, category) {
  container.appendChild(buildBackButton("← All Categories", () => {
    studentBrowseCategory = null;
    renderStudentBooks();
  }));

  const heading = document.createElement("p");
  heading.className = "browse-heading";
  heading.textContent = category + " — choose a section.";
  container.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "category-grid";
  const subcats = SUBCATEGORY_OPTIONS[category] || ["General"];
  subcats.forEach(sub => {
    const count = books.filter(b => b.category === category && (b.subcategory || "General") === sub).length;
    const card = document.createElement("div");
    card.className = "category-card browse-card";
    card.onclick = () => { studentBrowseSubcategory = sub; renderStudentBooks(); };
    card.append(createCategoryArtwork(category, sub));
    card.insertAdjacentHTML("beforeend", `<h3>${sub}</h3><span class="browse-count">${count} book${count === 1 ? "" : "s"}</span>`);
    grid.appendChild(card);
  });
  container.appendChild(grid);
}

function renderBrowseBooks(container, category, subcategory) {
  container.appendChild(buildBackButton(`← ${category}`, () => {
    studentBrowseSubcategory = null;
    renderStudentBooks();
  }));

  const heading = document.createElement("p");
  heading.className = "browse-heading";
  heading.textContent = category + " • " + subcategory;
  container.appendChild(heading);

  const matches = books.filter(b => b.category === category && (b.subcategory || "General") === subcategory);
  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dashboard-panel";
    empty.innerHTML = `<h3>No books here yet</h3><p style="color:var(--muted);margin-top:8px;">Check back soon.</p>`;
    container.appendChild(empty);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "large-book-grid";
  matches.forEach(book => grid.appendChild(buildBookCard(book)));
  container.appendChild(grid);
}

function buildBackButton(label, onClick) {
  const back = document.createElement("button");
  back.type = "button";
  back.className = "browse-back";
  back.textContent = label;
  back.onclick = onClick;
  return back;
}

function buildBookCard(book) {
  const card = document.createElement("div");
  card.className = "large-book-card";
  const availableCopies = Number(book.available_copies ?? (book.status === "Available" ? 1 : 0));
  const myCopies = getCurrentStudentsBorrowingsForBook(book.id);
  const myCopyCount = myCopies.length;
  const reservation = getCurrentStudentsReservation(book.id);
  const reservedCopies = Number(book.active_reservations ?? 0);
  const onlyReservedCopiesRemain = !reservation && availableCopies > 0 && availableCopies <= reservedCopies;
  const borrowingLimitReached = hasReachedBorrowingLimit();
  const statusClass = availableCopies > 0 && !onlyReservedCopiesRemain ? "available" : "issued";
  const canIssue = !borrowingLimitReached && (Boolean(reservation && reservation.is_ready) || (!reservation && availableCopies > 0 && !onlyReservedCopiesRemain));
  const buttonText = borrowingLimitReached
      ? "Limit Reached"
    : reservation
      ? (reservation.is_ready ? "Issue Reserved Book" : `Reserved #${reservation.queue_position}`)
      : (availableCopies > 0 ? (onlyReservedCopiesRemain ? "Reserved for queue" : (myCopyCount > 0 ? "Issue Another Copy" : "Issue Book")) : "Reserve Book");
  const details = document.createElement("div");
  details.className = "large-book-info";
  details.innerHTML = `
      <h3>${book.title}</h3><p>${book.author}</p>
      <p>${book.category}${book.subcategory ? " • " + book.subcategory : ""}</p>
      <p style="font-weight:600; color:var(--gold);">₹${Number(book.price || 0).toFixed(0)}</p>
      <p>${availableCopies} of ${book.total_copies || 1} ${Number(book.total_copies || 1) === 1 ? "copy" : "copies"} available</p>
      ${myCopyCount > 0 ? `<p>You currently hold ${myCopyCount} ${myCopyCount === 1 ? "copy" : "copies"} of this title.</p>` : ""}
      ${borrowingLimitReached ? `<p class="overdue-text">You already have the maximum ${libraryPolicy.max_active_borrowings} active books.</p>` : ""}
      <div class="book-card-bottom">
        <span class="status ${statusClass}">${availableCopies > 0 ? (onlyReservedCopiesRemain ? "Reserved" : "Available") : "All Issued"}</span>
        <button type="button" class="action-button" ${canIssue || (!reservation && availableCopies <= 0 && !borrowingLimitReached) ? "" : "disabled"} onclick="studentBookAction(${book.id})">${buttonText}</button>
      </div>
    `;
  card.append(createBookArtwork(book, "large-book-cover"), details);
  return card;
}

async function refreshStudentLibrary() {
  await Promise.all([fetchBooks(), fetchBorrowings(), fetchReservations(currentUser.id), fetchReportSummary()]);
  updateStudentStats();
  renderStudentBooks();
  renderRecommendedBooks();
  renderMyBooks();
  renderMyReservations();
  renderStudentPayments();
}

async function studentBookAction(bookId) {
  const book = books.find(item => item.id === bookId);
  if (!book) return;

  const reservation = getCurrentStudentsReservation(bookId);
  if (hasReachedBorrowingLimit()) return;
  if (reservation && !reservation.is_ready) return;

  const onlyReservedCopiesRemain = Number(book.available_copies ?? 0) > 0
    && Number(book.available_copies ?? 0) <= Number(book.active_reservations ?? 0);
  if (!reservation && onlyReservedCopiesRemain) return;

  if (!reservation && Number(book.available_copies ?? 0) <= 0) {
    await studentReserveBook(bookId);
    return;
  }

  await studentIssueBook(bookId);
}

async function studentReserveBook(bookId) {
  if (pendingBookActions.has(bookId)) return;

  pendingBookActions.add(bookId);
  try {
    const result = await apiReserveBook(bookId, currentUser.id);
    showToast(result.message);
    if (!result.success) return;
    await refreshStudentLibrary();
  } catch (error) {
    console.error("Reservation failed:", error);
    showToast("Could not reserve this book. Please try again.");
  } finally {
    pendingBookActions.delete(bookId);
  }
}

async function studentIssueBook(bookId) {
  const book = books.find(b => b.id === bookId);
  if (!book) return;
  if (pendingBookActions.has(bookId)) return;

  pendingBookActions.add(bookId);
  try {
    const result = await apiIssueBook(bookId, currentUser.id);

    showToast(result.message);
    if (!result.success) return;

    await refreshStudentLibrary();
  } catch (error) {
    console.error("Book action failed:", error);
    showToast("Could not complete the book action. Please try again.");
  } finally {
    pendingBookActions.delete(bookId);
  }
}

function renderMyBooks() {
  const container = document.getElementById("myBooksList");
  if (!container) return;

  const myBooks = borrowings
    .filter(loan => loan.student_id === currentUser.id && !loan.returned_at)
    .map(loan => {
      const book = books.find(item => item.id === loan.book_id);
      if (!book) return null;

      // Keep the catalogue book ID intact. The borrowing row has its own ID;
      // spreading it directly over the book used to overwrite `book.id`, so a
      // Return click could target a completely different book.
      const { id: loanId, ...loanDetails } = loan;
      return { ...book, ...loanDetails, loan_id: loanId };
    })
    .filter(Boolean);

  if (myBooks.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);">You have not issued any books yet.</p>`;
    return;
  }

  const copyGroups = new Map();
  myBooks.forEach(book => {
    const copies = copyGroups.get(book.id) || [];
    copies.push(book);
    copyGroups.set(book.id, copies);
  });

  container.innerHTML = "";
  myBooks.forEach(book => {
    const item = document.createElement("div");
    item.className = "borrowed-item";
    const outstandingFine = Number(book.fine_due_amount || 0);
    const renewalCount = Number(book.renewal_count || 0);
    const renewalLimit = Number(libraryPolicy.max_renewals_per_loan || 1);
    const hasWaitingReservation = Number(book.active_reservations || 0) > 0;
    const canRenew = !isPastDue(book.due_date) && renewalCount < renewalLimit && !hasWaitingReservation;
    const renewalMessage = hasWaitingReservation
      ? "Renewal unavailable — another student is waiting for this book."
      : renewalCount >= renewalLimit
        ? "Renewal limit used for this book."
        : isPastDue(book.due_date)
          ? "Overdue books must be returned before renewal."
          : `Renewal available: ${renewalLimit - renewalCount} time left.`;
    const fineMessage = outstandingFine > 0
      ? `<p class="overdue-text">Fine due: ₹${outstandingFine.toFixed(0)} — pay after returning the book.</p>`
      : "";
    const copiesOfThisTitle = copyGroups.get(book.id) || [book];
    const copyNumber = copiesOfThisTitle.findIndex(copy => copy.loan_id === book.loan_id) + 1;
    const copyMessage = copiesOfThisTitle.length > 1
      ? `<p class="copy-info">Physical copy ${copyNumber} of ${copiesOfThisTitle.length} issued to you</p>`
      : "";
    item.innerHTML = `
      <div class="borrowed-cover">${book.icon}</div>
      <div class="borrowed-info"><h3>${book.title}</h3>${copyMessage}<p>${book.author} • ₹${Number(book.price || 0).toFixed(0)}</p><p>Issued: ${formatDateTime(book.issued_at)} • Due: ${formatDate(book.due_date)}</p><p>Renewal: ${renewalCount}/${renewalLimit} • ${renewalMessage}</p>${isPastDue(book.due_date) ? `<p class="overdue-text">Overdue — return this book soon.</p>` : ""}${fineMessage}</div>
      <span class="status ${isPastDue(book.due_date) ? "overdue" : "issued"}">${isPastDue(book.due_date) ? "Overdue" : "Issued"}</span>
      <div class="borrowed-actions">
        <button type="button" class="action-button" ${canRenew ? "" : "disabled"} onclick="renewMyBook(${book.loan_id})">Renew +${libraryPolicy.renewal_period_days} Days</button>
        <button type="button" class="action-button" onclick="returnMyBorrowing(${book.loan_id})">Return</button>
      </div>`;
    item.querySelector(".borrowed-cover").replaceWith(createBookArtwork(book, "borrowed-cover"));
    container.appendChild(item);
  });
}

async function returnMyBorrowing(borrowingId) {
  if (!currentUser || pendingBookActions.has(`return-${borrowingId}`)) return;
  if (!confirm("Return this copy to the library?")) return;

  const pendingKey = `return-${borrowingId}`;
  pendingBookActions.add(pendingKey);
  try {
    const result = await apiReturnBorrowing(borrowingId, currentUser.id);
    showToast(result.message);
    if (result.success) await refreshStudentLibrary();
  } catch (error) {
    console.error("Book return failed:", error);
    showToast("Could not return this book. Please try again.");
  } finally {
    pendingBookActions.delete(pendingKey);
  }
}

async function renewMyBook(borrowingId) {
  if (!currentUser || pendingBookActions.has(`renew-${borrowingId}`)) return;
  if (!confirm(`Renew this book for ${libraryPolicy.renewal_period_days} more days?`)) return;

  const pendingKey = `renew-${borrowingId}`;
  pendingBookActions.add(pendingKey);
  try {
    const result = await apiRenewBorrowing(borrowingId, currentUser.id);
    showToast(result.message);
    if (result.success) await refreshStudentLibrary();
  } catch (error) {
    console.error("Book renewal failed:", error);
    showToast("Could not renew this book. Please try again.");
  } finally {
    pendingBookActions.delete(pendingKey);
  }
}

function renderMyReservations() {
  const container = document.getElementById("myReservationsList");
  if (!container) return;

  if (reservations.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);">You have no active reservations.</p>`;
    return;
  }

  container.innerHTML = "";
  reservations.forEach(reservation => {
    const item = document.createElement("div");
    item.className = "borrowed-item";
    const ready = Boolean(reservation.is_ready);
    const state = ready ? "Ready to issue" : `Waiting list: #${reservation.queue_position}`;
    item.innerHTML = `
      <div class="borrowed-cover">${reservation.icon || "📚"}</div>
      <div class="borrowed-info"><h3>${reservation.title}</h3><p>${reservation.author}</p><p>Reserved: ${formatDateTime(reservation.reserved_at)}</p><p>${ready ? "A copy is available for you now." : "We will keep your place in the queue."}</p></div>
      <span class="status ${ready ? "available" : "issued"}">${state}</span>
      <button type="button" class="action-button" onclick="cancelStudentReservation(${reservation.id})">Cancel</button>`;
    const reservedBook = books.find(book => book.id === reservation.book_id) || reservation;
    item.querySelector(".borrowed-cover").replaceWith(createBookArtwork(reservedBook, "borrowed-cover"));
    container.appendChild(item);
  });
}

// ---------------- FINE PAYMENTS & RECEIPTS ----------------

function paymentStatusClass(status) {
  if (status === "Paid") return "available";
  if (status === "Unpaid") return "overdue";
  return "issued";
}

function renderStudentPayments() {
  const container = document.getElementById("studentPaymentsList");
  if (!container || !currentUser) return;

  const paymentLoans = borrowings.filter(loan =>
    loan.student_id === currentUser.id
    && loan.returned_at
    && Number(loan.fine_amount || 0) > 0
  );

  if (paymentLoans.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);">No overdue fines yet. Your books remain free when returned within ${libraryPolicy.loan_period_days} days.</p>`;
    return;
  }

  container.innerHTML = "";
  paymentLoans.forEach(loan => {
    const fineAmount = Number(loan.fine_amount || 0);
    const fineDue = Number(loan.fine_due_amount || 0);
    const paymentStatus = loan.fine_payment_status || "No Fine";
    const requestedMode = loan.fine_payment_request_mode || "Cash";
    const paidMode = loan.fine_payment_mode || "Cash";
    const item = document.createElement("div");
    item.className = "book-request-item payment-item";

    let paymentContent = `<p><strong>Fine:</strong> ₹${fineAmount.toFixed(0)} • Returned: ${formatDateTime(loan.returned_at)}</p>`;
    if (paymentStatus === "Paid") {
      paymentContent += `<p class="receipt-details"><strong>Paid by ${escapeHtml(paidMode)}</strong> on ${formatDateTime(loan.fine_paid_at)}<br>Receipt: ${escapeHtml(loan.fine_receipt_number || "Not available")}</p>`;
    } else if (paymentStatus === "Awaiting Confirmation") {
      paymentContent += `<p class="receipt-details">${escapeHtml(requestedMode)} payment request sent ${formatDateTime(loan.fine_payment_requested_at)}. Please pay the librarian; they will confirm it.</p>`;
    } else if (fineDue > 0) {
      paymentContent += `<p class="receipt-details">Fine due: <strong>₹${fineDue.toFixed(0)}</strong>. Select how you will pay the librarian.</p>`;
    }

    const actions = paymentStatus === "Paid"
      ? `<div class="payment-actions"><button type="button" class="action-button receipt-button" onclick="printFineReceipt(${loan.id})">Print Receipt</button></div>`
      : paymentStatus === "Awaiting Confirmation"
        ? ""
        : `<div class="payment-actions"><button type="button" class="action-button" onclick="requestFinePayment(${loan.id}, 'CASH')">Pay by Cash</button><button type="button" class="action-button" onclick="requestFinePayment(${loan.id}, 'UPI')">Pay by UPI</button></div>`;

    item.innerHTML = `
      <div class="request-icon">💳</div>
      <div class="request-content"><h3>${escapeHtml(loan.title)}</h3><p>${escapeHtml(loan.author || "Unknown author")}</p>${paymentContent}${actions}</div>
      <span class="status ${paymentStatusClass(paymentStatus)}">${escapeHtml(paymentStatus)}</span>`;
    container.appendChild(item);
  });
}

async function requestFinePayment(borrowingId, paymentMode) {
  if (!currentUser || pendingBookActions.has(`payment-request-${borrowingId}`)) return;
  const loan = borrowings.find(item => item.id === borrowingId);
  if (!loan) return;
  const amount = Number(loan.fine_due_amount || 0);
  if (amount <= 0) return;
  if (!confirm(`Send a ${paymentMode === "UPI" ? "UPI" : "Cash"} payment request for ₹${amount.toFixed(0)}? The librarian must confirm after receiving payment.`)) return;

  const pendingKey = `payment-request-${borrowingId}`;
  pendingBookActions.add(pendingKey);
  try {
    const result = await apiRequestFinePayment(borrowingId, currentUser.id, paymentMode);
    showToast(result.message);
    if (!result.success) return;
    await fetchBorrowings();
    renderStudentPayments();
  } catch (error) {
    console.error("Fine payment request failed:", error);
    showToast("Could not send the payment request. Please try again.");
  } finally {
    pendingBookActions.delete(pendingKey);
  }
}

function printFineReceipt(borrowingId) {
  const loan = borrowings.find(item => item.id === borrowingId);
  if (!loan || loan.fine_payment_status !== "Paid") {
    showToast("This receipt is available after payment confirmation.");
    return;
  }
  const receiptWindow = window.open("", "_blank", "width=720,height=760");
  if (!receiptWindow) {
    showToast("Please allow pop-ups to print the receipt.");
    return;
  }
  const amount = Number(loan.fine_paid_amount || loan.fine_amount || 0);
  receiptWindow.document.write(`<!doctype html><html><head><title>BookVerse Fine Receipt</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:42px}.receipt{max-width:560px;margin:auto;border:1px solid #d7dce8;border-radius:14px;padding:30px}.brand{color:#6855d9;font-weight:700;letter-spacing:1px}.paid{color:#16854a;font-weight:700}table{width:100%;border-collapse:collapse;margin:22px 0}td{padding:10px 0;border-bottom:1px solid #e7eaf2}td:last-child{text-align:right}h1{margin:6px 0 2px}p{color:#61708a;line-height:1.5}.footer{margin-top:26px;font-size:12px;color:#77849a}</style></head><body><div class="receipt"><div class="brand">BOOKVERSE LIBRARY</div><h1>Fine Payment Receipt</h1><p class="paid">Payment confirmed</p><table><tr><td>Receipt number</td><td>${escapeHtml(loan.fine_receipt_number)}</td></tr><tr><td>Student</td><td>${escapeHtml(currentUser.name)}</td></tr><tr><td>Book</td><td>${escapeHtml(loan.title)}</td></tr><tr><td>Payment method</td><td>${escapeHtml(loan.fine_payment_mode || "Cash")}</td></tr><tr><td>Paid on</td><td>${escapeHtml(formatDateTime(loan.fine_paid_at))}</td></tr><tr><td><strong>Fine paid</strong></td><td><strong>₹${amount.toFixed(0)}</strong></td></tr></table><p class="footer">This is a system-generated receipt for the BookVerse Library Management System.</p></div><script>window.onload=()=>window.print();<\/script></body></html>`);
  receiptWindow.document.close();
}

async function cancelStudentReservation(reservationId) {
  const reservation = reservations.find(item => item.id === reservationId);
  if (!reservation || pendingBookActions.has(`reservation-${reservationId}`)) return;
  if (!confirm(`Cancel your reservation for "${reservation.title}"?`)) return;

  const pendingKey = `reservation-${reservationId}`;
  pendingBookActions.add(pendingKey);
  try {
    const result = await apiCancelReservation(reservationId, currentUser.id);
    showToast(result.message);
    if (!result.success) return;
    await refreshStudentLibrary();
  } catch (error) {
    console.error("Reservation cancellation failed:", error);
    showToast("Could not cancel the reservation. Please try again.");
  } finally {
    pendingBookActions.delete(pendingKey);
  }
}


// ---------------- BOOK REQUESTS ----------------

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function bookRequestStatusClass(status) {
  if (status === "Approved") return "available";
  if (status === "Rejected") return "overdue";
  return "issued";
}

async function refreshStudentBookRequests() {
  if (!currentUser || currentUser.role !== "Student") return;
  await fetchBookRequests(currentUser.id);
  renderStudentBookRequests();
}

async function submitBookRequest(event) {
  event.preventDefault();
  if (!currentUser || currentUser.role !== "Student") return;
  const pendingKey = "book-request-submit";
  if (pendingBookActions.has(pendingKey)) return;

  const requestData = {
    student_id: currentUser.id,
    title: document.getElementById("requestBookTitle").value.trim(),
    author: document.getElementById("requestBookAuthor").value.trim(),
    category: document.getElementById("requestBookCategory").value,
    reason: document.getElementById("requestBookReason").value.trim()
  };
  pendingBookActions.add(pendingKey);
  try {
    const result = await apiCreateBookRequest(requestData);
    showToast(result.message);
    if (!result.success) return;
    event.target.reset();
    await refreshStudentBookRequests();
  } catch (error) {
    console.error("Book request submission failed:", error);
    showToast("Could not submit the request. Please try again.");
  } finally {
    pendingBookActions.delete(pendingKey);
  }
}

function renderStudentBookRequests() {
  const container = document.getElementById("studentBookRequestsList");
  if (!container) return;
  if (bookRequests.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);">You have not requested any new books yet.</p>`;
    return;
  }

  container.innerHTML = "";
  bookRequests.forEach(request => {
    const item = document.createElement("div");
    item.className = "book-request-item";
    const author = request.author ? ` by ${escapeHtml(request.author)}` : "";
    const category = request.category && request.category !== "Other" ? ` • ${escapeHtml(request.category)}` : "";
    const reason = request.reason ? `<p><strong>Your note:</strong> ${escapeHtml(request.reason)}</p>` : "";
    const review = request.status === "Pending"
      ? `<p class="request-note">Waiting for librarian review.</p>`
      : `<p class="request-note"><strong>Librarian note:</strong> ${escapeHtml(request.reviewer_note || (request.status === "Approved" ? "Approved for consideration." : "No note added."))}</p>`;
    item.innerHTML = `<div class="request-icon">📚</div><div class="request-content"><h3>${escapeHtml(request.title)}</h3><p>${author || "Author not specified"}${category}</p><p>Requested: ${formatDateTime(request.requested_at)}</p>${reason}${review}</div><span class="status ${bookRequestStatusClass(request.status)}">${escapeHtml(request.status)}</span>`;
    container.appendChild(item);
  });
}

async function refreshAdminBookRequests() {
  await fetchBookRequests();
  renderAdminBookRequests();
}

function renderAdminBookRequests() {
  const container = document.getElementById("adminBookRequestsList");
  if (!container) return;
  if (bookRequests.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);">No student book requests yet.</p>`;
    return;
  }

  container.innerHTML = "";
  bookRequests.forEach(request => {
    const item = document.createElement("div");
    item.className = "book-request-item admin-request-item";
    const author = request.author ? ` by ${escapeHtml(request.author)}` : "";
    const category = request.category && request.category !== "Other" ? ` • ${escapeHtml(request.category)}` : "";
    const reason = request.reason ? `<p><strong>Student note:</strong> ${escapeHtml(request.reason)}</p>` : "";
    const review = request.status === "Pending"
      ? ""
      : `<p class="request-note"><strong>Review:</strong> ${escapeHtml(request.reviewer_note || "No note added.")}</p>`;
    const actions = request.status === "Pending"
      ? `<div class="request-actions"><button type="button" class="action-button" onclick="reviewBookRequest(${request.id}, 'Approved')">Approve</button><button type="button" class="action-button delete-button" onclick="reviewBookRequest(${request.id}, 'Rejected')">Reject</button></div>`
      : "";
    item.innerHTML = `<div class="request-icon">📝</div><div class="request-content"><h3>${escapeHtml(request.title)}</h3><p>${author || "Author not specified"}${category}</p><p>Requested by ${escapeHtml(request.student_name)} (${escapeHtml(request.student_username)}) • ${formatDateTime(request.requested_at)}</p>${reason}${review}</div><span class="status ${bookRequestStatusClass(request.status)}">${escapeHtml(request.status)}</span>${actions}`;
    container.appendChild(item);
  });
}

async function reviewBookRequest(requestId, status) {
  const request = bookRequests.find(item => item.id === requestId);
  if (!request || pendingBookActions.has(`book-request-${requestId}`)) return;
  const promptText = status === "Rejected"
    ? `Why is "${request.title}" being rejected?`
    : `Optional note for the student about "${request.title}":`;
  const reviewerNote = prompt(promptText, "");
  if (reviewerNote === null) return;

  const pendingKey = `book-request-${requestId}`;
  pendingBookActions.add(pendingKey);
  try {
    const result = await apiReviewBookRequest(requestId, status, reviewerNote.trim());
    showToast(result.message);
    if (result.success) await refreshAdminBookRequests();
  } catch (error) {
    console.error("Book request review failed:", error);
    showToast("Could not review the request. Please try again.");
  } finally {
    pendingBookActions.delete(pendingKey);
  }
}


// ---------------- RENDER: ADMIN ----------------

function renderRecentBooks() {
  const container = document.getElementById("recentBooks");
  container.innerHTML = "";
  books.slice(0, 5).forEach(book => {
    const row = document.createElement("div");
    row.className = "admin-book-row";
    const availableCopies = Number(book.available_copies ?? 0);
    const statusClass = availableCopies > 0 ? "available" : "issued";
    row.innerHTML = `<span>${book.icon}</span><div><h3>${book.title}</h3><p>${book.author}</p></div><span class="status ${statusClass}">${availableCopies}/${book.total_copies || 1} Available</span><small>₹${Number(book.price || 0).toFixed(0)}</small>`;
    row.querySelector("span").replaceWith(createBookArtwork(book, "admin-book-artwork"));
    container.appendChild(row);
  });
}

function renderIssuedBooks() {
  const container = document.getElementById("issuedBooksList");
  if (!container) return;

  const issued = borrowings.filter(loan => !loan.returned_at);
  if (issued.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);">No books are currently issued.</p>`;
    return;
  }

  container.innerHTML = "";
  issued.forEach(loan => {
    const book = books.find(item => item.id === loan.book_id);
    if (!book) return;
    const row = document.createElement("div");
    row.className = "admin-book-row";
    const dueDate = loan.due_date ? `Due: ${formatDate(loan.due_date)}` : "Due date unavailable";
    const stateClass = loan.is_overdue ? "overdue" : "issued";
    const state = loan.is_overdue ? "Overdue" : `Issued to: ${loan.student_name || loan.borrower_name || "Unknown"}`;
    row.innerHTML = `<span>${book.icon}</span><div><h3>${book.title}</h3><p>${book.author}</p><small>${dueDate}</small></div><span class="status ${stateClass}">${state}</span><small>BK-${book.id}</small>`;
    row.querySelector("span").replaceWith(createBookArtwork(book, "admin-book-artwork"));
    container.appendChild(row);
  });
}

function renderReservationQueue() {
  const container = document.getElementById("reservationQueueList");
  if (!container) return;

  if (reservations.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);">No students are waiting for a book right now.</p>`;
    return;
  }

  container.innerHTML = "";
  reservations.forEach(reservation => {
    const row = document.createElement("div");
    row.className = "admin-book-row";
    const state = reservation.is_ready ? "Ready for issue" : `Queue #${reservation.queue_position}`;
    row.innerHTML = `<span>${reservation.icon || "📚"}</span><div><h3>${reservation.title}</h3><p>${reservation.student_name} (${reservation.student_username}) • Reserved ${formatDateTime(reservation.reserved_at)}</p></div><span class="status ${reservation.is_ready ? "available" : "issued"}">${state}</span><small>${reservation.available_copies}/${reservation.total_copies} available</small>`;
    const reservedBook = books.find(book => book.id === reservation.book_id) || reservation;
    row.querySelector("span").replaceWith(createBookArtwork(reservedBook, "admin-book-artwork"));
    container.appendChild(row);
  });
}

function renderRecentActivity() {
  const container = document.getElementById("recentActivityList");
  if (!container) return;

  container.innerHTML = "";
  if (recentActivity.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);">No issue or return activity yet.</p>`;
    return;
  }

  recentActivity.forEach(activity => {
    const row = document.createElement("div");
    row.className = "activity-item";

    const icon = document.createElement("span");
    icon.textContent = activity.book_icon || "📚";

    const details = document.createElement("div");
    const title = document.createElement("strong");
    const action = activity.activity_type === "returned" ? "returned" : "issued";
    title.textContent = `${activity.person_name || "Student"} ${action} “${activity.book_title || "a book"}”`;

    const description = document.createElement("p");
    description.textContent = action === "returned" ? "Book returned to the library" : "Book issued from the library";

    const time = document.createElement("small");
    time.textContent = formatDateTime(activity.activity_at);

    details.append(title, description, time);
    row.append(icon, details);
    container.appendChild(row);
  });
}

async function renderStudents() {
  const container = document.querySelector("#manageStudents .student-list");
  if (!container) return;

  container.innerHTML = `<p style="color:var(--muted);">Loading...</p>`;
  const students = await fetchStudents();

  const searchField = document.getElementById("studentAdminSearch");
  const search = searchField ? searchField.value.trim().toLowerCase() : "";
  const filteredStudents = students.filter(student =>
    student.name.toLowerCase().includes(search) ||
    student.username.toLowerCase().includes(search) ||
    String(student.roll_number || "").toLowerCase().includes(search)
  );

  const pendingPayments = borrowings.filter(loan =>
    loan.returned_at
    && loan.fine_payment_status === "Awaiting Confirmation"
    && Number(loan.fine_due_amount || 0) > 0
  );
  const overdueLoans = getOverdueBorrowings();
  const summary = document.getElementById("pendingFinePaymentsSummary");
  if (summary) {
    const paymentText = pendingPayments.length > 0
      ? `<strong>${pendingPayments.length} payment confirmation${pendingPayments.length === 1 ? "" : "s"} waiting.</strong> Use the Payments button beside the relevant student to confirm it directly.`
      : `<strong>No payment confirmations are waiting.</strong> When a student selects Cash or UPI, it will appear beside their name here.`;
    const overdueText = overdueLoans.length > 0
      ? ` <strong>⚠️ ${overdueLoans.length} overdue loan${overdueLoans.length === 1 ? "" : "s"} need attention.</strong>`
      : "";
    summary.innerHTML = paymentText + overdueText;
  }

  if (filteredStudents.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);">${search ? "No students match your search." : "No students have registered yet."}</p>`;
    return;
  }

  container.innerHTML = "";
  filteredStudents.forEach(student => {
    const row = document.createElement("div");
    row.className = "student-row";
    const initial = student.name.charAt(0).toUpperCase();
    const loanCount = Number(student.active_borrowings || 0);
    const academicInfo = [student.roll_number || "Roll no. not added", student.course || "Course not added", student.semester ? `Semester ${student.semester}` : "Semester not added"].join(" • ");
    const studentPendingPayments = pendingPayments.filter(loan => loan.student_id === student.id);
    const studentOverdueLoans = overdueLoans.filter(loan => loan.student_id === student.id);
    const safeStudentName = JSON.stringify(student.name).replace(/"/g, "&quot;");
    const paymentButton = studentPendingPayments.length > 0
      ? `<button type="button" class="action-button pending-payment-button" onclick="openStudentPaymentsModal(${student.id}, ${safeStudentName})">Payments (${studentPendingPayments.length})</button>`
      : `<span class="no-pending-payments">No pending payment</span>`;
    const overdueBadge = studentOverdueLoans.length > 0
      ? `<span class="student-overdue-badge">⚠️ ${studentOverdueLoans.length} overdue</span>`
      : "";
    row.innerHTML = `<div class="student-avatar">${escapeHtml(initial)}</div><div class="student-info"><strong>${escapeHtml(student.name)}</strong><span>${escapeHtml(student.username)} • ${loanCount} active loan${loanCount === 1 ? "" : "s"}</span><span>${escapeHtml(academicInfo)}</span>${overdueBadge}</div><div class="student-payment-shortcut">${paymentButton}</div><div class="student-actions"><button type="button" class="action-button" onclick="openStudentBorrowingsModal(${student.id}, ${safeStudentName})">View</button><button type="button" class="action-button" onclick="openEditStudentModal(${student.id})">Edit</button><button type="button" class="action-button delete-button" onclick="deleteStudent(${student.id})">Delete</button></div>`;
    container.appendChild(row);
  });
}

function openStudentPaymentsModal(studentId, studentName) {
  activeStudentPaymentStudent = { id: studentId, name: studentName };
  studentPaymentsModal.classList.add("active");
  document.getElementById("studentPaymentsName").textContent = `${studentName}'s Pending Payments`;
  const container = document.getElementById("studentPaymentsAdminList");
  const pendingPayments = borrowings.filter(loan =>
    loan.student_id === studentId
    && loan.returned_at
    && loan.fine_payment_status === "Awaiting Confirmation"
    && Number(loan.fine_due_amount || 0) > 0
  );

  if (pendingPayments.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);">No payment confirmation is waiting for this student.</p>`;
    return;
  }

  container.innerHTML = "";
  pendingPayments.forEach(loan => {
    const item = document.createElement("div");
    item.className = "admin-payment-item";
    const amount = Number(loan.fine_due_amount || 0);
    const paymentMode = loan.fine_payment_request_mode === "UPI" ? "UPI" : "Cash";
    item.innerHTML = `<div><h3>${escapeHtml(loan.title)}</h3><p>${escapeHtml(loan.author || "Unknown author")}</p><p>Fine due: <strong>₹${amount.toFixed(0)}</strong> • Requested by ${paymentMode}</p><p>Requested: ${formatDateTime(loan.fine_payment_requested_at)}</p></div><button type="button" class="action-button" onclick="collectFine(${loan.id}, '${paymentMode === "UPI" ? "UPI" : "CASH"}')">Confirm ${paymentMode}</button>`;
    container.appendChild(item);
  });
}

function closeStudentPaymentsModal() {
  activeStudentPaymentStudent = null;
  studentPaymentsModal.classList.remove("active");
}


// ---------------- STUDENT BORROWINGS MODAL ----------------

async function openStudentBorrowingsModal(studentId, studentName) {
  studentBorrowingsModal.classList.add("active");
  document.getElementById("studentBorrowingsName").textContent = studentName;
  document.getElementById("studentBorrowingsList").innerHTML = `<p style="color:var(--muted);">Loading...</p>`;

  const borrowings = await fetchStudentBorrowings(studentId);

  // Update stats
  const totalBorrowings = borrowings.length;
  const activeBorrowings = borrowings.filter(b => !b.returned_at).length;
  const totalFines = borrowings.reduce((sum, b) => sum + Number(b.current_fine || 0), 0);

  document.getElementById("studentTotalBorrowings").textContent = totalBorrowings;
  document.getElementById("studentActiveBorrowings").textContent = activeBorrowings;
  document.getElementById("studentTotalFines").textContent = `₹${totalFines.toFixed(0)}`;

  // Render borrowings list
  const container = document.getElementById("studentBorrowingsList");
  if (borrowings.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);">This student has no borrowing history.</p>`;
    return;
  }

  container.innerHTML = "";
  borrowings.forEach(borrowing => {
    const item = document.createElement("div");
    item.className = "borrowed-item";
    const isReturned = borrowing.returned_at !== null;
    const isOverdue = borrowing.is_overdue === 1;
    const fine = Number(borrowing.current_fine || 0);
    const statusClass = isReturned ? "returned" : (isOverdue ? "overdue" : "issued");
    const statusText = isReturned ? "Returned" : (isOverdue ? "Overdue" : "Issued");

    item.innerHTML = `
      <div class="borrowed-cover">${borrowing.icon || "📚"}</div>
      <div class="borrowed-info">
        <h3>${borrowing.title}</h3>
        <p>${borrowing.author} • ₹${Number(borrowing.price || 0).toFixed(0)}</p>
        <p>Issued: ${formatDateTime(borrowing.issued_at)} • Due: ${formatDate(borrowing.due_date)}</p>
        ${isReturned ? `<p>Returned: ${formatDateTime(borrowing.returned_at)}</p>` : ""}
        ${fine > 0 ? `<p class="overdue-text">Fine: ₹${fine.toFixed(0)}</p>` : ""}
      </div>
      <span class="status ${statusClass}">${statusText}</span>
    `;
    item.querySelector(".borrowed-cover").replaceWith(createBookArtwork(borrowing, "borrowed-cover"));
    container.appendChild(item);
  });
}

function closeStudentBorrowingsModal() {
  studentBorrowingsModal.classList.remove("active");
}


// ---------------- EDIT STUDENT MODAL ----------------

async function openEditStudentModal(studentId) {
  const students = await fetchStudents();
  const student = students.find(s => s.id === studentId);
  if (!student) return;

  editingStudentId = studentId;
  document.getElementById("editStudentRoll").value = student.roll_number || "";
  document.getElementById("editStudentPhone").value = student.phone || "";
  document.getElementById("editStudentCourse").value = student.course || "";
  document.getElementById("editStudentSemester").value = student.semester || "";
  editStudentModal.classList.add("active");
  setTimeout(() => document.getElementById("editStudentRoll").focus(), 100);
}

function closeEditStudentModal() {
  editStudentModal.classList.remove("active");
  editingStudentId = null;
}

async function saveStudentChanges(event) {
  event.preventDefault();
  if (!editingStudentId) return;

  const roll_number = document.getElementById("editStudentRoll").value.trim();
  const phone = document.getElementById("editStudentPhone").value.trim();
  const course = document.getElementById("editStudentCourse").value.trim();
  const semester = document.getElementById("editStudentSemester").value;

  const result = await apiEditStudent(editingStudentId, {
    roll_number, phone, course, semester
  });

  if (!result.success) {
    showToast(result.message);
    return;
  }

  closeEditStudentModal();
  await renderStudents();
  showToast(result.message);
}

async function deleteStudent(studentId) {
  const students = await fetchStudents();
  const student = students.find(s => s.id === studentId);
  if (!student) return;

  if (!confirm(`Are you sure you want to delete student "${student.name}"?\n\nThis will also delete all their borrowing history and reservations.`)) return;

  const result = await apiDeleteStudent(studentId);
  showToast(result.message);
  if (!result.success) return;

  await renderStudents();
}


// ---------------- STUDENT SELECTION MODAL ----------------

async function openStudentSelectModal(bookId, bookTitle) {
  pendingIssueBookId = bookId;
  selectedStudentId = null;
  document.getElementById("studentSelectBookTitle").textContent = `Issue: ${bookTitle}`;
  document.getElementById("studentSelectConfirmBtn").disabled = true;
  document.getElementById("studentSelectList").innerHTML = `<p style="color:var(--muted);">Loading students...</p>`;
  studentSelectModal.classList.add("active");

  const students = await fetchStudents();
  const container = document.getElementById("studentSelectList");

  if (students.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);">No students registered yet.</p>`;
    return;
  }

  container.innerHTML = "";
  students.forEach(student => {
    const item = document.createElement("div");
    const loanCount = Number(student.active_borrowings || 0);
    const limitReached = loanCount >= Number(libraryPolicy.max_active_borrowings || 5);
    item.className = `student-select-item${limitReached ? " selection-unavailable" : ""}`;
    item.onclick = () => {
      if (limitReached) {
        showToast(`${student.name} already has the maximum ${libraryPolicy.max_active_borrowings} active books.`);
        return;
      }
      selectStudent(student.id, item);
    };
    const initial = student.name.charAt(0).toUpperCase();
    const academicInfo = [student.roll_number || "Roll no. not added", student.course || "Course not added"].join(" • ");
    item.innerHTML = `<div class="student-avatar">${initial}</div><div><strong>${student.name}</strong><span>${student.username} • ${loanCount}/${libraryPolicy.max_active_borrowings} active books${limitReached ? " • Limit reached" : ""}</span><span>${academicInfo}</span></div>`;
    container.appendChild(item);
  });
}

function closeStudentSelectModal() {
  studentSelectModal.classList.remove("active");
  selectedStudentId = null;
  pendingIssueBookId = null;
}

function selectStudent(studentId, element) {
  selectedStudentId = studentId;
  document.querySelectorAll(".student-select-item").forEach(item => item.classList.remove("selected"));
  element.classList.add("selected");
  document.getElementById("studentSelectConfirmBtn").disabled = false;
}

async function confirmStudentSelection() {
  if (!selectedStudentId || !pendingIssueBookId) return;

  const result = await apiIssueBook(pendingIssueBookId, selectedStudentId);
  showToast(result.message);
  if (!result.success) return;

  closeStudentSelectModal();
  await Promise.all([fetchBooks(), fetchBorrowings(), fetchReservations(), fetchReportSummary(), fetchRecentActivity()]);
  updateAdminStats();
  renderAdminReportSummary();
  renderAdminBooks();
  renderRecentBooks();
  renderIssuedBooks();
  renderReservationQueue();
  renderRecentActivity();
}


// ---------------- LOAN HISTORY & REPORTS ----------------

async function refreshLoanHistory() {
  await Promise.all([fetchBorrowings(), fetchReportSummary(), fetchBooks()]);
  updateAdminStats();
  renderAdminReportSummary();
  renderLoanHistory();
}

function renderAdminReportSummary() {
  if (!reportSummary) return;
  const setValue = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value || 0;
  };
  setValue("reportTransactions", reportSummary.total_transactions);
  setValue("reportActiveLoans", reportSummary.active_loans);
  setValue("reportReturnedBooks", reportSummary.returned_books);
  setValue("reportOverdueBooks", reportSummary.overdue_books);
  setValue("reportFineCollected", `₹${Number(reportSummary.total_fine_collected || 0).toFixed(0)}`);
  setValue("reportPendingFine", `₹${Number(reportSummary.pending_fine || 0).toFixed(0)}`);

  const container = document.getElementById("popularBooksList");
  if (!container) return;
  const popularBooks = reportSummary.popular_books || [];
  if (popularBooks.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);">No borrowing activity yet.</p>`;
    return;
  }
  container.innerHTML = "";
  popularBooks.forEach(book => {
    const row = document.createElement("div");
    row.className = "admin-book-row";
    row.innerHTML = `<span>${book.icon}</span><div><h3>${book.title}</h3><p>${book.author}</p></div><small>${book.issue_count} issue${book.issue_count === 1 ? "" : "s"}</small>`;
    row.querySelector("span").replaceWith(createBookArtwork(book, "admin-book-artwork"));
    container.appendChild(row);
  });
}

function renderLoanHistory() {
  const table = document.getElementById("loanHistoryTable");
  if (!table) return;
  const filtered = getFilteredBorrowings();
  if (filtered.length === 0) {
    table.innerHTML = `<tr><td colspan="8" class="table-empty">No borrowing records found.</td></tr>`;
    return;
  }
  table.innerHTML = "";
  filtered.forEach(loan => {
    const state = loan.returned_at ? "Returned" : (loan.is_overdue ? "Overdue" : "Issued");
    const stateClass = loan.returned_at ? "returned" : (loan.is_overdue ? "overdue" : "issued");
    const fineAmount = Number(loan.fine_amount || 0);
    const fineDue = Number(loan.fine_due_amount || 0);
    const paymentStatus = loan.fine_payment_status || "No Fine";
    const paymentClass = paymentStatusClass(paymentStatus);
    const paymentDate = loan.fine_paid_at
      ? `<div class="book-id">${formatDateTime(loan.fine_paid_at)} • ${escapeHtml(loan.fine_payment_mode || "Cash")}<br>${escapeHtml(loan.fine_receipt_number || "")}</div>`
      : loan.fine_payment_requested_at
        ? `<div class="book-id">${escapeHtml(loan.fine_payment_request_mode || "Cash")} request: ${formatDateTime(loan.fine_payment_requested_at)}</div>`
        : "";
    const renewalText = `Renewal: ${Number(loan.renewal_count || 0)}/${libraryPolicy.max_renewals_per_loan}`;
    const collectButton = loan.returned_at && fineDue > 0
      ? `<button type="button" class="action-button" onclick="collectFine(${loan.id}, '${loan.fine_payment_request_mode === "UPI" ? "UPI" : "CASH"}')">${paymentStatus === "Awaiting Confirmation" ? `Confirm ${loan.fine_payment_request_mode || "Cash"}` : `Collect ₹${fineDue.toFixed(0)}`}</button>`
      : "—";
    const row = document.createElement("tr");
    row.innerHTML = `<td><strong>${loan.title}</strong><div class="book-id">BK-${loan.book_id} • ${renewalText}</div></td><td>${loan.student_name || loan.borrower_name || "Unknown"}</td><td>${formatDateTime(loan.issued_at)}</td><td>${formatDate(loan.due_date)}</td><td><span class="status ${stateClass}">${state}</span>${loan.returned_at ? `<div class="book-id">${formatDateTime(loan.returned_at)}</div>` : ""}</td><td>₹${fineAmount.toFixed(0)}${fineDue > 0 ? `<div class="book-id">Due: ₹${fineDue.toFixed(0)}</div>` : ""}</td><td><span class="status ${paymentClass}">${paymentStatus}</span>${paymentDate}</td><td>${collectButton}</td>`;
    table.appendChild(row);
  });
}

async function collectFine(borrowingId, paymentMode = "CASH") {
  const loan = borrowings.find(item => item.id === borrowingId);
  if (!loan || pendingBookActions.has(`fine-${borrowingId}`)) return;
  const amount = Number(loan.fine_due_amount || 0);
  if (amount <= 0) return;
  const actionText = loan.fine_payment_status === "Awaiting Confirmation"
    ? `Confirm ${paymentMode === "UPI" ? "UPI" : "Cash"} payment of ₹${amount.toFixed(0)} from ${loan.student_name || "this student"}?`
    : `Collect ₹${amount.toFixed(0)} fine by ${paymentMode === "UPI" ? "UPI" : "Cash"} from ${loan.student_name || "this student"}?`;
  if (!confirm(actionText)) return;

  const pendingKey = `fine-${borrowingId}`;
  pendingBookActions.add(pendingKey);
  try {
    const result = await apiCollectFine(borrowingId, paymentMode);
    showToast(result.message);
    if (result.success) {
      await refreshLoanHistory();
      await renderStudents();
      if (activeStudentPaymentStudent) {
        openStudentPaymentsModal(activeStudentPaymentStudent.id, activeStudentPaymentStudent.name);
      }
    }
  } catch (error) {
    console.error("Fine collection failed:", error);
    showToast("Could not collect the fine. Please try again.");
  } finally {
    pendingBookActions.delete(pendingKey);
  }
}

function getFilteredBorrowings() {
  const searchField = document.getElementById("historySearch");
  const search = searchField ? searchField.value.trim().toLowerCase() : "";
  return borrowings.filter(loan =>
    String(loan.title || "").toLowerCase().includes(search) ||
    String(loan.student_name || "").toLowerCase().includes(search) ||
    String(loan.borrower_name || "").toLowerCase().includes(search)
  );
}

function csvValue(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function exportLoanHistoryCSV() {
  const rows = getFilteredBorrowings();
  if (rows.length === 0) {
    showToast("There are no borrowing records to export.");
    return;
  }

  const header = [
    "Loan ID", "Book ID", "Book Title", "Author", "Student", "Issued At",
    "Due Date", "Returned At", "Status", "Overdue Days", "Fine Amount (INR)",
    "Fine Due (INR)", "Fine Payment Status", "Fine Paid At", "Payment Method", "Receipt Number", "Payment Requested At", "Requested Payment Method", "Renewal Count"
  ];
  const dataRows = rows.map(loan => {
    const status = loan.returned_at ? "Returned" : (loan.is_overdue ? "Overdue" : "Issued");
    return [
      loan.id,
      loan.book_id,
      loan.title,
      loan.author,
      loan.student_name || loan.borrower_name || "Unknown",
      loan.issued_at,
      loan.due_date,
      loan.returned_at || "",
      status,
      loan.overdue_days || 0,
      loan.fine_amount || 0,
      loan.fine_due_amount || 0,
      loan.fine_payment_status || "No Fine",
      loan.fine_paid_at || "",
      loan.fine_payment_mode || "",
      loan.fine_receipt_number || "",
      loan.fine_payment_requested_at || "",
      loan.fine_payment_request_mode || "",
      loan.renewal_count || 0
    ];
  });

  const csv = [header, ...dataRows]
    .map(row => row.map(csvValue).join(","))
    .join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = `bookverse-loan-history-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
  showToast(`${rows.length} record${rows.length === 1 ? "" : "s"} exported to CSV.`);
}

function renderAdminBooks() {
  const table = document.getElementById("adminBookTable");
  const search = document.getElementById("adminSearch").value.trim().toLowerCase();
  table.innerHTML = "";

  const filtered = books.filter(b =>
    b.title.toLowerCase().includes(search) || b.author.toLowerCase().includes(search) ||
    String(b.id).toLowerCase().includes(search)
  );

  filtered.forEach(book => {
    const row = document.createElement("tr");
    const availableCopies = Number(book.available_copies ?? 0);
    const activeCopies = Number(book.active_borrowings ?? 0);
    const statusClass = availableCopies > 0 ? "available" : "issued";
    row.innerHTML = `
      <td><strong>${book.title}</strong><div class="book-id">BK-${book.id}${book.isbn ? " • " + book.isbn : ""}</div></td>
      <td>${book.author}<div class="book-id">${book.publisher || "Publisher not added"}</div></td>
      <td>${book.category}${book.subcategory ? " • " + book.subcategory : ""}</td>
      <td>₹${Number(book.price || 0).toFixed(0)}</td>
      <td><span class="status ${statusClass}">${availableCopies}/${book.total_copies || 1} Available</span></td>
      <td class="admin-actions">
        ${availableCopies > 0 ? `<button type="button" class="action-button" onclick="adminToggleBook(${book.id}, 'issue')">Issue</button>` : ""}
        ${activeCopies > 0 ? `<button type="button" class="action-button" onclick="adminToggleBook(${book.id}, 'return')">Return One</button>` : ""}
        <button type="button" class="action-button" onclick="openEditBookModal(${book.id})">Edit</button>
        <button type="button" class="action-button delete-button" onclick="deleteBook(${book.id})">Delete</button>
      </td>`;
    table.appendChild(row);
  });
}

async function adminToggleBook(bookId, action) {
  const book = books.find(b => b.id === bookId);
  if (!book) return;

  if (action === "issue") {
    const students = await fetchStudents();
    if (students.length === 0) {
      showToast("Register a student before issuing a book.");
      return;
    }
    openStudentSelectModal(bookId, book.title);
    return;
  }

  const result = await apiReturnBook(bookId, null, true);
  showToast(result.message);
  if (!result.success) return;

  await Promise.all([fetchBooks(), fetchBorrowings(), fetchReservations(), fetchReportSummary(), fetchRecentActivity()]);
  updateAdminStats();
  renderAdminReportSummary();
  renderAdminBooks();
  renderRecentBooks();
  renderIssuedBooks();
  renderReservationQueue();
  renderRecentActivity();
}

async function deleteBook(bookId) {
  const book = books.find(b => b.id === bookId);
  if (!book) return;

  if (!confirm("Do you really want to delete this book?\n\n" + book.title)) return;

  const result = await apiDeleteBook(bookId);
  showToast(result.message);
  if (!result.success) return;

  await fetchBooks();
  updateAdminStats();
  renderAdminBooks();
  renderRecentBooks();
  renderIssuedBooks();
  renderRecommendedBooks();
  renderStudentBooks();
}

async function importCatalogueBooks() {
  if (pendingBookActions.has("catalogue-import")) return;
  const confirmed = confirm(
    "Import real book records from Open Library?\n\n" +
    "Up to 2 books will be added to each existing subcategory. Existing titles will be skipped."
  );
  if (!confirmed) return;

  const button = document.getElementById("importCatalogueButton");
  const originalLabel = button ? button.textContent : "↓ Import Real Books";
  pendingBookActions.add("catalogue-import");
  if (button) {
    button.disabled = true;
    button.textContent = "Importing catalogue…";
  }

  try {
    const result = await apiImportCatalogueBooks();
    showToast(result.message || "Catalogue import finished.");
    if (!result.success) return;

    await fetchBooks();
    updateAdminStats();
    renderAdminBooks();
    renderRecentBooks();
    renderRecommendedBooks();
    renderStudentBooks();
  } catch (error) {
    console.error("Catalogue import failed:", error);
    showToast("Could not import the online catalogue. Please try again.");
  } finally {
    pendingBookActions.delete("catalogue-import");
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}


// ---------------- ADD BOOK ----------------

function updateSubcategoryOptions() {
  const category = document.getElementById("bookCategory").value;
  const subSelect = document.getElementById("bookSubcategory");
  const options = SUBCATEGORY_OPTIONS[category] || ["General"];
  subSelect.innerHTML = options.map(opt => `<option value="${opt}">${opt}</option>`).join("");
}

function openAddBookModal() {
  addBookModal.classList.add("active");
  updateSubcategoryOptions();
  setTimeout(() => document.getElementById("bookTitle").focus(), 100);
}

function closeAddBookModal() {
  addBookModal.classList.remove("active");
  document.getElementById("bookTitle").value = "";
  document.getElementById("bookAuthor").value = "";
  document.getElementById("bookPrice").value = "";
  document.getElementById("bookCopies").value = "3";
  document.getElementById("bookIsbn").value = "";
  document.getElementById("bookPublisher").value = "";
  document.getElementById("bookYear").value = "";
  document.getElementById("bookShelf").value = "";
}

async function addNewBook(event) {
  event.preventDefault();
  const title = document.getElementById("bookTitle").value.trim();
  const author = document.getElementById("bookAuthor").value.trim();
  const category = document.getElementById("bookCategory").value;
  const subcategory = document.getElementById("bookSubcategory").value;
  const price = document.getElementById("bookPrice").value;
  const total_copies = document.getElementById("bookCopies").value;
  const isbn = document.getElementById("bookIsbn").value.trim();
  const publisher = document.getElementById("bookPublisher").value.trim();
  const publication_year = document.getElementById("bookYear").value;
  const shelf_location = document.getElementById("bookShelf").value.trim();

  if (!title || !author) { showToast("Please enter the book title and author."); return; }

  const result = await apiAddBook({ title, author, category, subcategory, price, total_copies, isbn, publisher, publication_year, shelf_location });
  closeAddBookModal();
  if (!result.success) { showToast(result.message); return; }

  await fetchBooks();
  updateAdminStats();
  renderAdminBooks();
  renderRecentBooks();
  renderIssuedBooks();
  renderStudentBooks();
  renderRecommendedBooks();
  showToast(`"${title}" was added successfully.`);
}


// ---------------- TOAST ----------------

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}


// ---------------- EDIT BOOK ----------------

function updateEditSubcategoryOptions(selectedSubcategory = null) {
  const category = document.getElementById("editBookCategory").value;
  const subSelect = document.getElementById("editBookSubcategory");
  const options = SUBCATEGORY_OPTIONS[category] || ["General"];
  subSelect.innerHTML = options.map(opt => `<option value="${opt}">${opt}</option>`).join("");
  if (selectedSubcategory && options.includes(selectedSubcategory)) {
    subSelect.value = selectedSubcategory;
  }
}

function openEditBookModal(bookId) {
  const book = books.find(item => item.id === bookId);
  if (!book) return;

  editingBookId = bookId;
  document.getElementById("editBookTitle").value = book.title;
  document.getElementById("editBookAuthor").value = book.author;
  document.getElementById("editBookCategory").value = book.category;
  updateEditSubcategoryOptions(book.subcategory);
  document.getElementById("editBookPrice").value = Number(book.price || 0);
  document.getElementById("editBookCopies").value = Number(book.total_copies || 1);
  document.getElementById("editBookIsbn").value = book.isbn || "";
  document.getElementById("editBookPublisher").value = book.publisher || "";
  document.getElementById("editBookYear").value = book.publication_year || "";
  document.getElementById("editBookShelf").value = book.shelf_location || "";
  editBookModal.classList.add("active");
  setTimeout(() => document.getElementById("editBookTitle").focus(), 100);
}

function closeEditBookModal() {
  editBookModal.classList.remove("active");
  editingBookId = null;
}

async function saveBookChanges(event) {
  event.preventDefault();
  if (!editingBookId) return;

  const title = document.getElementById("editBookTitle").value.trim();
  const author = document.getElementById("editBookAuthor").value.trim();
  const category = document.getElementById("editBookCategory").value;
  const subcategory = document.getElementById("editBookSubcategory").value;
  const price = document.getElementById("editBookPrice").value;
  const total_copies = document.getElementById("editBookCopies").value;
  const isbn = document.getElementById("editBookIsbn").value.trim();
  const publisher = document.getElementById("editBookPublisher").value.trim();
  const publication_year = document.getElementById("editBookYear").value;
  const shelf_location = document.getElementById("editBookShelf").value.trim();

  if (!title || !author) {
    showToast("Please enter the book title and author.");
    return;
  }
  if (price !== "" && (!Number.isFinite(Number(price)) || Number(price) < 0)) {
    showToast("Price cannot be negative.");
    return;
  }
  if (!Number.isInteger(Number(total_copies)) || Number(total_copies) < 1) {
    showToast("Total copies must be at least 1.");
    return;
  }

  const result = await apiUpdateBook(editingBookId, { title, author, category, subcategory, price, total_copies, isbn, publisher, publication_year, shelf_location });
  if (!result.success) {
    showToast(result.message);
    return;
  }

  closeEditBookModal();
  await Promise.all([fetchBooks(), fetchBorrowings(), fetchReportSummary()]);
  updateAdminStats();
  renderAdminReportSummary();
  renderAdminBooks();
  renderRecentBooks();
  renderIssuedBooks();
  showToast(`"${title}" was updated successfully.`);
}

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric"
  });
}

function formatDateTime(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}


// ---------------- EVENT LISTENERS ----------------

loginModal.addEventListener("click", e => { if (e.target === loginModal) closeLogin(); });
addBookModal.addEventListener("click", e => { if (e.target === addBookModal) closeAddBookModal(); });
editBookModal.addEventListener("click", e => { if (e.target === editBookModal) closeEditBookModal(); });
editStudentModal.addEventListener("click", e => { if (e.target === editStudentModal) closeEditStudentModal(); });
studentSelectModal.addEventListener("click", e => { if (e.target === studentSelectModal) closeStudentSelectModal(); });
studentBorrowingsModal.addEventListener("click", e => { if (e.target === studentBorrowingsModal) closeStudentBorrowingsModal(); });
studentPaymentsModal.addEventListener("click", e => { if (e.target === studentPaymentsModal) closeStudentPaymentsModal(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeLogin(); closeAddBookModal(); closeEditBookModal(); closeEditStudentModal(); closeStudentSelectModal(); closeStudentBorrowingsModal(); closeStudentPaymentsModal(); }
});


// ---------------- INITIAL LOAD ----------------

fetchBooks().then(() => renderRecommendedBooks());
