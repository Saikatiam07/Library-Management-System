from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import math
import re

app = Flask(__name__)
CORS(app)

DATABASE = Path("library.db")

BOOK_CATEGORIES = {
    "Comics": {"Marvel", "DC"},
    "Science": {"Physics", "Chemistry", "Mathematics", "General"},
    "Programming": {"Python", "JavaScript", "Java", "C / C++", "General"},
    "Novels": {"Fiction", "Classic", "General"},
    "Other": set()
}
FINE_PER_DAY = 2
# A student may carry up to five physical copies at once. A title can still
# only be issued up to its actual stock count (normally three copies).
MAX_ACTIVE_BORROWINGS = 5
LOAN_PERIOD_DAYS = 15
RENEWAL_PERIOD_DAYS = 7
MAX_RENEWALS_PER_LOAN = 1
ROLL_NUMBER_PATTERN = re.compile(r"^[A-Z]{2,10}/[A-Z]{2,20}/\d{1,4}/\d{2,4}/\d{1,6}$")
PHONE_PATTERN = re.compile(r"^[0-9+() -]{7,20}$")

# A deliberately small, one-time catalogue import. These search terms map real
# Open Library records into the same sections already used by the BookVerse UI.
CATALOGUE_IMPORTS = (
    ("Marvel comics", "Comics", "Marvel"),
    ("DC comics", "Comics", "DC"),
    ("subject:physics", "Science", "Physics"),
    ("subject:chemistry", "Science", "Chemistry"),
    ("subject:mathematics", "Science", "Mathematics"),
    ("science books", "Science", "General"),
    ("python programming", "Programming", "Python"),
    ("javascript programming", "Programming", "JavaScript"),
    ("java programming", "Programming", "Java"),
    ("c++ programming", "Programming", "C / C++"),
    ("computer programming", "Programming", "General"),
    ("fiction novels", "Novels", "Fiction"),
    ("classic literature", "Novels", "Classic"),
    ("novels", "Novels", "General"),
)
OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json"
CATALOGUE_BOOKS_PER_SECTION = 2


def get_db():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


def icon_for_category(category):
    mapping = {
        "Comics": "🦸",
        "Science": "🔬",
        "Programming": "💻",
        "Novels": "📖"
    }
    return mapping.get(category, "📚")


def validate_book_payload(data):
    if not isinstance(data, dict):
        return None, "Book details must be sent as JSON."

    title = str(data.get("title", "") or "").strip()
    author = str(data.get("author", "") or "").strip()
    category = str(data.get("category", "Other") or "Other").strip()
    subcategory = str(data.get("subcategory", "") or "").strip()
    price_value = data.get("price", 0)
    isbn = str(data.get("isbn", "") or "").strip()
    publisher = str(data.get("publisher", "") or "").strip()
    shelf_location = str(data.get("shelf_location", "") or "").strip()
    year_value = data.get("publication_year", "")
    copies_value = data.get("total_copies", 1)

    if not title or not author:
        return None, "Book title and author are required."
    if category not in BOOK_CATEGORIES:
        return None, "Please choose a valid book category."
    if subcategory and subcategory not in BOOK_CATEGORIES[category]:
        return None, "Please choose a valid subcategory for this category."

    try:
        price = 0 if price_value in (None, "") else float(price_value)
    except (TypeError, ValueError):
        return None, "Price must be a valid number."
    if not math.isfinite(price) or price < 0:
        return None, "Price cannot be negative."

    try:
        total_copies = int(copies_value)
    except (TypeError, ValueError):
        return None, "Total copies must be a whole number."
    if total_copies < 1 or total_copies > 50:
        return None, "Total copies must be between 1 and 50."

    if year_value in (None, ""):
        publication_year = None
    else:
        try:
            publication_year = int(year_value)
        except (TypeError, ValueError):
            return None, "Publication year must be a valid year."
        if publication_year < 1000 or publication_year > datetime.now().year + 1:
            return None, "Publication year is outside the valid range."

    return {
        "title": title,
        "author": author,
        "category": category,
        "subcategory": subcategory,
        "price": price,
        "isbn": isbn,
        "publisher": publisher,
        "publication_year": publication_year,
        "shelf_location": shelf_location,
        "total_copies": total_copies,
        "image_url": ""
    }, None


def validate_student_profile(data):
    if not isinstance(data, dict):
        return None, "Profile details must be sent as JSON."

    name = str(data.get("name", "") or "").strip()
    roll_number = str(data.get("roll_number", "") or "").strip().upper()
    phone = str(data.get("phone", "") or "").strip()
    course = str(data.get("course", "") or "").strip()
    semester_value = data.get("semester", "")

    if len(name) < 2 or len(name) > 80:
        return None, "Full name must contain between 2 and 80 characters."
    if not ROLL_NUMBER_PATTERN.fullmatch(roll_number):
        return None, "Roll number must follow the format UG/SOET/30/24/340."
    if not PHONE_PATTERN.fullmatch(phone):
        return None, "Enter a valid phone number."
    if len(course) < 2 or len(course) > 100:
        return None, "Course or department must contain between 2 and 100 characters."

    try:
        semester = int(semester_value)
    except (TypeError, ValueError):
        return None, "Semester must be a whole number."
    if semester < 1 or semester > 12:
        return None, "Semester must be between 1 and 12."

    return {
        "name": name,
        "roll_number": roll_number,
        "phone": phone,
        "course": course,
        "semester": semester,
    }, None


def calculate_overdue_fine(due_date):
    """Return the current fine for a due date, using the library's daily rate."""
    try:
        days_overdue = max(0, (datetime.now().date() - datetime.fromisoformat(due_date).date()).days)
    except (TypeError, ValueError):
        return 0
    return days_overdue * FINE_PER_DAY


def catalogue_book_key(title, author):
    """Build a duplicate-safe catalogue key independent of punctuation/case."""
    normalize = lambda value: re.sub(r"[^a-z0-9]", "", str(value or "").lower())
    return normalize(title), normalize(author)


def fetch_open_library_section(search_query, category, subcategory):
    """Read a small set of real records from Open Library for one UI section."""
    parameters = urlencode({
        "q": search_query,
        "limit": CATALOGUE_BOOKS_PER_SECTION,
        "fields": "title,author_name,first_publish_year,isbn,publisher,cover_i",
    })
    request = Request(
        f"{OPEN_LIBRARY_SEARCH_URL}?{parameters}",
        headers={
            "Accept": "application/json",
            "User-Agent": "BookVerse-College-Project/1.0 (catalogue import)",
        },
    )
    try:
        with urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        return [], f"{category} / {subcategory}: {error}"

    if not isinstance(payload, dict):
        return [], f"{category} / {subcategory}: unexpected catalogue response"

    records = []
    for item in payload.get("docs", []):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "") or "").strip()
        authors = item.get("author_name") or []
        if not isinstance(authors, list):
            authors = [authors]
        author = str(authors[0] if authors else "Unknown author").strip()
        if not title or len(title) > 200 or len(author) > 200:
            continue

        year = item.get("first_publish_year")
        year = year if isinstance(year, int) and 1000 <= year <= datetime.now().year + 1 else None
        isbns = item.get("isbn") or []
        if not isinstance(isbns, list):
            isbns = [isbns]
        isbn = next((str(value).strip() for value in isbns if str(value).strip()), "")
        publishers = item.get("publisher") or []
        if not isinstance(publishers, list):
            publishers = [publishers]
        publisher = str(publishers[0] if publishers else "").strip()
        records.append({
            "title": title,
            "author": author,
            "category": category,
            "subcategory": subcategory,
            "isbn": isbn[:30],
            "publisher": publisher[:120],
            "publication_year": year,
        })
    return records, None


def init_database():
    connection = get_db()

    connection.execute("""
        CREATE TABLE IF NOT EXISTS books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            author TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'Other',
            subcategory TEXT NOT NULL DEFAULT '',
            price REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'Available',
            icon TEXT NOT NULL DEFAULT '📚',
            issued_to TEXT DEFAULT ''
        )
    """)

    connection.execute("""
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    """)

    existing_student_columns = {
        column["name"] for column in connection.execute("PRAGMA table_info(students)").fetchall()
    }
    new_student_columns = {
        "roll_number": "TEXT NOT NULL DEFAULT ''",
        "phone": "TEXT NOT NULL DEFAULT ''",
        "course": "TEXT NOT NULL DEFAULT ''",
        "semester": "INTEGER"
    }
    for column_name, column_type in new_student_columns.items():
        if column_name not in existing_student_columns:
            connection.execute(f"ALTER TABLE students ADD COLUMN {column_name} {column_type}")
    connection.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS unique_student_roll_number
        ON students(roll_number)
        WHERE roll_number <> ''
    """)

    existing_book_columns = {
        column["name"] for column in connection.execute("PRAGMA table_info(books)").fetchall()
    }
    new_book_columns = {
        "isbn": "TEXT NOT NULL DEFAULT ''",
        "publisher": "TEXT NOT NULL DEFAULT ''",
        "publication_year": "INTEGER",
        "shelf_location": "TEXT NOT NULL DEFAULT ''",
        "total_copies": "INTEGER NOT NULL DEFAULT 1"
    }
    for column_name, column_type in new_book_columns.items():
        if column_name not in existing_book_columns:
            connection.execute(f"ALTER TABLE books ADD COLUMN {column_name} {column_type}")

    # Existing book rows represented one visible title each. Give every legacy
    # title three copies so the upgraded demo can support multiple students.
    if "total_copies" not in existing_book_columns:
        connection.execute("UPDATE books SET total_copies = 3")

    connection.execute("""
        CREATE TABLE IF NOT EXISTS borrowings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id INTEGER NOT NULL,
            student_id INTEGER,
            borrower_name TEXT NOT NULL DEFAULT '',
            issued_at TEXT NOT NULL,
            due_date TEXT NOT NULL,
            returned_at TEXT DEFAULT NULL,
            FOREIGN KEY (book_id) REFERENCES books(id),
            FOREIGN KEY (student_id) REFERENCES students(id)
        )
    """)

    # These columns make fine collection persistent while keeping the current
    # fine for active loans dynamic. Existing borrowing history is preserved.
    existing_borrowing_columns = {
        column["name"] for column in connection.execute("PRAGMA table_info(borrowings)").fetchall()
    }
    new_borrowing_columns = {
        "fine_amount": "REAL NOT NULL DEFAULT 0",
        "fine_paid_amount": "REAL NOT NULL DEFAULT 0",
        "fine_paid_at": "TEXT DEFAULT NULL",
        "fine_payment_mode": "TEXT NOT NULL DEFAULT ''",
        "fine_receipt_number": "TEXT NOT NULL DEFAULT ''",
        "fine_payment_requested_at": "TEXT DEFAULT NULL",
        "fine_payment_request_mode": "TEXT NOT NULL DEFAULT ''",
        "renewal_count": "INTEGER NOT NULL DEFAULT 0",
        "last_renewed_at": "TEXT DEFAULT NULL",
    }
    for column_name, column_type in new_borrowing_columns.items():
        if column_name not in existing_borrowing_columns:
            connection.execute(f"ALTER TABLE borrowings ADD COLUMN {column_name} {column_type}")
    connection.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS unique_fine_receipt_number
        ON borrowings(fine_receipt_number)
        WHERE fine_receipt_number <> ''
    """)

    # A title can have several physical copies. A student may borrow more than
    # one copy when stock exists, subject to the overall borrowing limit.
    connection.execute("DROP INDEX IF EXISTS one_active_borrowing_per_book")
    connection.execute("DROP INDEX IF EXISTS one_active_borrowing_per_student_book")

    connection.execute("""
        CREATE TABLE IF NOT EXISTS reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            reserved_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Active',
            cancelled_at TEXT DEFAULT NULL,
            fulfilled_at TEXT DEFAULT NULL,
            FOREIGN KEY (book_id) REFERENCES books(id),
            FOREIGN KEY (student_id) REFERENCES students(id)
        )
    """)
    connection.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS one_active_reservation_per_student_book
        ON reservations(book_id, student_id)
        WHERE status = 'Active'
    """)

    connection.execute("""
        CREATE TABLE IF NOT EXISTS book_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            author TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT 'Other',
            reason TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'Pending',
            requested_at TEXT NOT NULL,
            reviewed_at TEXT DEFAULT NULL,
            reviewer_note TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (student_id) REFERENCES students(id)
        )
    """)
    connection.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS one_pending_book_request_per_student_title
        ON book_requests(student_id, title, author)
        WHERE status = 'Pending'
    """)

    # Preserve any loans made before the borrowing table existed. A matching
    # student is linked when possible; otherwise the old borrower name remains.
    legacy_issues = connection.execute("""
        SELECT id, issued_to FROM books
        WHERE status = 'Issued'
          AND NOT EXISTS (
              SELECT 1 FROM borrowings
              WHERE borrowings.book_id = books.id AND returned_at IS NULL
          )
    """).fetchall()
    for legacy_issue in legacy_issues:
        borrower_name = legacy_issue["issued_to"] or "Unknown"
        student = connection.execute(
            "SELECT id FROM students WHERE username = ? OR name = ? ORDER BY id LIMIT 1",
            (borrower_name, borrower_name)
        ).fetchone()
        issued_at = datetime.now().isoformat(timespec="seconds")
        due_date = (datetime.now() + timedelta(days=LOAN_PERIOD_DAYS)).date().isoformat()
        connection.execute(
            """INSERT INTO borrowings (book_id, student_id, borrower_name, issued_at, due_date)
               VALUES (?, ?, ?, ?, ?)""",
            (legacy_issue["id"], student["id"] if student else None, borrower_name, issued_at, due_date)
        )

    # Older frontend versions sent the literal fallback name "Student" instead
    # of an account ID. If this is a single-student demo database, reconnect
    # those records to that one account so the student can see and return them.
    students = connection.execute("SELECT id, name FROM students ORDER BY id").fetchall()
    if len(students) == 1:
        only_student = students[0]
        unlinked_demo_loans = connection.execute("""
            SELECT book_id FROM borrowings
            WHERE returned_at IS NULL
              AND student_id IS NULL
              AND borrower_name IN ('Student', '')
        """).fetchall()
        for loan in unlinked_demo_loans:
            connection.execute(
                "UPDATE borrowings SET student_id = ?, borrower_name = ? WHERE book_id = ? AND returned_at IS NULL",
                (only_student["id"], only_student["name"], loan["book_id"])
            )
            connection.execute(
                "UPDATE books SET issued_to = ? WHERE id = ?",
                (only_student["name"], loan["book_id"])
            )

    connection.execute("""
        UPDATE books
        SET status = CASE
            WHEN (SELECT COUNT(*) FROM borrowings
                  WHERE borrowings.book_id = books.id AND borrowings.returned_at IS NULL) >= total_copies
            THEN 'Issued' ELSE 'Available'
        END
    """)

    connection.commit()
    connection.close()


@app.route("/")
def home():
    return jsonify({"message": "Library Management System Backend is running!"})


@app.route("/api/library-policy", methods=["GET"])
def get_library_policy():
    """Expose the same borrowing rules used by the server to both dashboards."""
    return jsonify({
        "max_active_borrowings": MAX_ACTIVE_BORROWINGS,
        "loan_period_days": LOAN_PERIOD_DAYS,
        "renewal_period_days": RENEWAL_PERIOD_DAYS,
        "max_renewals_per_loan": MAX_RENEWALS_PER_LOAN,
        "fine_per_day": FINE_PER_DAY,
    })


# ---------------- BOOKS ----------------

@app.route("/api/books", methods=["GET"])
def get_books():
    connection = get_db()
    books = connection.execute("""
        SELECT books.*,
               COUNT(borrowings.id) AS active_borrowings,
               books.total_copies - COUNT(borrowings.id) AS available_copies,
               (SELECT COUNT(*) FROM reservations
                WHERE reservations.book_id = books.id AND reservations.status = 'Active') AS active_reservations
        FROM books
        LEFT JOIN borrowings
          ON borrowings.book_id = books.id AND borrowings.returned_at IS NULL
        GROUP BY books.id
        ORDER BY books.id DESC
    """).fetchall()
    connection.close()
    return jsonify([dict(b) for b in books])


@app.route("/api/books", methods=["POST"])
def add_book():
    book_data, error = validate_book_payload(request.get_json(silent=True))
    if error:
        return jsonify({"success": False, "message": error}), 400

    icon = icon_for_category(book_data["category"])

    connection = get_db()
    cursor = connection.execute(
        """INSERT INTO books
           (title, author, category, subcategory, price, status, icon, issued_to,
            isbn, publisher, publication_year, shelf_location, total_copies)
           VALUES (?, ?, ?, ?, ?, 'Available', ?, '', ?, ?, ?, ?, ?)""",
        (book_data["title"], book_data["author"], book_data["category"],
         book_data["subcategory"], book_data["price"], icon, book_data["isbn"],
         book_data["publisher"], book_data["publication_year"], book_data["shelf_location"],
         book_data["total_copies"])
    )
    connection.commit()
    book_id = cursor.lastrowid
    connection.close()

    return jsonify({"success": True, "message": "Book added successfully.", "book_id": book_id}), 201


@app.route("/api/catalogue/import", methods=["POST"])
def import_catalogue_books():
    """Import a small, duplicate-safe catalogue from Open Library on admin request."""
    imported_records = []
    import_errors = []
    # Keep requests modest and concurrent so the admin does not wait through
    # every section one after another.
    with ThreadPoolExecutor(max_workers=4) as executor:
        jobs = [
            executor.submit(fetch_open_library_section, query, category, subcategory)
            for query, category, subcategory in CATALOGUE_IMPORTS
        ]
        for job in as_completed(jobs):
            try:
                records, error = job.result()
            except Exception as error:
                records = []
                error = f"online catalogue request: {error}"
            imported_records.extend(records)
            if error:
                import_errors.append(error)

    if not imported_records:
        return jsonify({
            "success": False,
            "message": "Could not reach the online catalogue. Check your internet connection and try again.",
        }), 503

    connection = get_db()
    existing_books = connection.execute("SELECT title, author FROM books").fetchall()
    existing_keys = {
        catalogue_book_key(book["title"], book["author"])
        for book in existing_books
    }
    added_count = 0
    skipped_count = 0

    connection.execute("BEGIN IMMEDIATE")
    for record in imported_records:
        key = catalogue_book_key(record["title"], record["author"])
        if key in existing_keys:
            skipped_count += 1
            continue

        shelf_code = f"AUTO-{record['category'][0]}{record['subcategory'][0]}-{added_count + 1:02d}"
        connection.execute(
            """INSERT INTO books
               (title, author, category, subcategory, price, status, icon, issued_to,
                isbn, publisher, publication_year, shelf_location, total_copies)
               VALUES (?, ?, ?, ?, 0, 'Available', ?, '', ?, ?, ?, ?, 3)""",
            (
                record["title"], record["author"], record["category"], record["subcategory"],
                icon_for_category(record["category"]), record["isbn"], record["publisher"],
                record["publication_year"], shelf_code,
            ),
        )
        existing_keys.add(key)
        added_count += 1

    connection.commit()
    connection.close()

    source_note = " Some online sections were unavailable; you can safely run the import again later." if import_errors else ""
    return jsonify({
        "success": True,
        "message": f"Imported {added_count} real catalogue book(s). {skipped_count} duplicate(s) were skipped." + source_note,
        "imported_count": added_count,
        "skipped_count": skipped_count,
        "partial_import": bool(import_errors),
    }), 201


@app.route("/api/books/<int:book_id>", methods=["PUT"])
def update_book(book_id):
    book_data, error = validate_book_payload(request.get_json(silent=True))
    if error:
        return jsonify({"success": False, "message": error}), 400

    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    book = connection.execute("SELECT id, total_copies FROM books WHERE id = ?", (book_id,)).fetchone()
    if book is None:
        connection.close()
        return jsonify({"success": False, "message": "Book not found."}), 404

    active_borrowings = connection.execute("""
        SELECT COUNT(*) AS count FROM borrowings
        WHERE book_id = ? AND returned_at IS NULL
    """, (book_id,)).fetchone()["count"]
    if book_data["total_copies"] < active_borrowings:
        connection.close()
        return jsonify({
            "success": False,
            "message": f"Cannot set copies below the {active_borrowings} currently issued copy/copies."
        }), 409

    connection.execute("""
        UPDATE books
        SET title = ?, author = ?, category = ?, subcategory = ?, price = ?, icon = ?,
            isbn = ?, publisher = ?, publication_year = ?, shelf_location = ?, total_copies = ?
        WHERE id = ?
    """, (
        book_data["title"], book_data["author"], book_data["category"],
        book_data["subcategory"], book_data["price"], icon_for_category(book_data["category"]),
        book_data["isbn"], book_data["publisher"], book_data["publication_year"],
        book_data["shelf_location"], book_data["total_copies"], book_id
    ))
    connection.execute("""
        UPDATE books SET status = ? WHERE id = ?
    """, ("Issued" if active_borrowings >= book_data["total_copies"] else "Available", book_id))
    connection.commit()
    connection.close()
    return jsonify({"success": True, "message": "Book updated successfully."})


@app.route("/api/books/<int:book_id>", methods=["DELETE"])
def delete_book(book_id):
    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    book = connection.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()

    if book is None:
        connection.close()
        return jsonify({"success": False, "message": "Book not found."}), 404

    active_borrowing = connection.execute(
        "SELECT id FROM borrowings WHERE book_id = ? AND returned_at IS NULL", (book_id,)
    ).fetchone()
    if active_borrowing is not None:
        connection.close()
        return jsonify({"success": False, "message": "Return this issued book before deleting it."}), 409

    active_reservation = connection.execute(
        "SELECT id FROM reservations WHERE book_id = ? AND status = 'Active'", (book_id,)
    ).fetchone()
    if active_reservation is not None:
        connection.close()
        return jsonify({"success": False, "message": "Cancel the active reservations before deleting this book."}), 409

    borrowing_history = connection.execute(
        "SELECT id FROM borrowings WHERE book_id = ? LIMIT 1", (book_id,)
    ).fetchone()
    if borrowing_history is not None:
        connection.close()
        return jsonify({
            "success": False,
            "message": "This book has loan history and cannot be deleted. Edit it instead to keep records accurate."
        }), 409

    connection.execute("DELETE FROM books WHERE id = ?", (book_id,))
    connection.commit()
    connection.close()
    return jsonify({"success": True, "message": "Book deleted successfully."})


@app.route("/api/books/<int:book_id>/issue", methods=["PUT"])
def issue_book(book_id):
    data = request.get_json(silent=True) or {}
    student_id = data.get("student_id")
    student_name = str(data.get("student_name", "")).strip()

    try:
        student_id = int(student_id)
    except (TypeError, ValueError):
        student_id = None

    if student_id is None and not student_name:
        return jsonify({"success": False, "message": "A valid student is required to issue a book."}), 400

    connection = get_db()
    # Serialize issue operations so fast repeated clicks cannot allocate more
    # copies than the title has in stock.
    connection.execute("BEGIN IMMEDIATE")
    book = connection.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()

    if book is None:
        connection.close()
        return jsonify({"success": False, "message": "Book not found."}), 404

    if student_id is not None:
        student = connection.execute(
            "SELECT id, name FROM students WHERE id = ?", (student_id,)
        ).fetchone()
    else:
        # Compatibility for an already-open page using the previous frontend.
        student = connection.execute(
            "SELECT id, name FROM students WHERE username = ? OR name = ? ORDER BY id LIMIT 1",
            (student_name, student_name)
        ).fetchone()
    if student is None:
        connection.close()
        return jsonify({"success": False, "message": "Student not found."}), 404

    student_active_loans = connection.execute("""
        SELECT COUNT(*) AS count FROM borrowings
        WHERE student_id = ? AND returned_at IS NULL
    """, (student["id"],)).fetchone()["count"]
    if student_active_loans >= MAX_ACTIVE_BORROWINGS:
        connection.close()
        return jsonify({
            "success": False,
            "message": f"Borrowing limit reached. A student can keep at most {MAX_ACTIVE_BORROWINGS} active books."
        }), 409

    active_count = connection.execute("""
        SELECT COUNT(*) AS count FROM borrowings
        WHERE book_id = ? AND returned_at IS NULL
    """, (book_id,)).fetchone()["count"]
    if active_count >= book["total_copies"]:
        connection.close()
        return jsonify({"success": False, "message": "All copies of this book are currently issued."}), 409

    active_reservation_count = connection.execute("""
        SELECT COUNT(*) AS count FROM reservations
        WHERE book_id = ? AND status = 'Active'
    """, (book_id,)).fetchone()["count"]
    next_reservation = connection.execute("""
        SELECT id, student_id FROM reservations
        WHERE book_id = ? AND status = 'Active'
        ORDER BY reserved_at ASC, id ASC
        LIMIT 1
    """, (book_id,)).fetchone()
    available_before_issue = book["total_copies"] - active_count
    reservation_is_for_student = (
        next_reservation is not None and next_reservation["student_id"] == student["id"]
    )
    if (next_reservation is not None and not reservation_is_for_student
            and available_before_issue <= active_reservation_count):
        connection.close()
        return jsonify({
            "success": False,
            "message": "This available copy is reserved for the next student in the waiting list."
        }), 409

    issued_at = datetime.now().isoformat(timespec="seconds")
    due_date = (datetime.now() + timedelta(days=LOAN_PERIOD_DAYS)).date().isoformat()

    try:
        connection.execute(
            """INSERT INTO borrowings (book_id, student_id, borrower_name, issued_at, due_date)
               VALUES (?, ?, ?, ?, ?)""",
            (book_id, student["id"], student["name"], issued_at, due_date)
        )
    except sqlite3.IntegrityError:
        connection.close()
        return jsonify({"success": False, "message": "Could not create the borrowing record. Please try again."}), 409
    remaining_copies = book["total_copies"] - active_count - 1
    if reservation_is_for_student:
        connection.execute("""
            UPDATE reservations
            SET status = 'Fulfilled', fulfilled_at = ?
            WHERE id = ?
        """, (issued_at, next_reservation["id"]))
    connection.execute(
        "UPDATE books SET status = ?, issued_to = ? WHERE id = ?",
        ("Available" if remaining_copies > 0 else "Issued", student["name"], book_id)
    )
    connection.commit()
    connection.close()
    return jsonify({"success": True, "message": "Book issued successfully.", "due_date": due_date,
                    "available_copies": remaining_copies})


@app.route("/api/books/<int:book_id>/return", methods=["PUT"])
def return_book(book_id):
    data = request.get_json(silent=True) or {}
    is_admin = data.get("is_admin") is True
    student_id = data.get("student_id")

    if not is_admin:
        try:
            student_id = int(student_id)
        except (TypeError, ValueError):
            return jsonify({"success": False, "message": "A valid student is required to return a book."}), 400

    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    book = connection.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()

    if book is None:
        connection.close()
        return jsonify({"success": False, "message": "Book not found."}), 404

    borrowing_query = "SELECT * FROM borrowings WHERE book_id = ? AND returned_at IS NULL"
    borrowing_params = [book_id]
    if not is_admin:
        borrowing_query += " AND student_id = ?"
        borrowing_params.append(student_id)
    borrowing_query += " ORDER BY issued_at ASC LIMIT 1"
    borrowing = connection.execute(borrowing_query, borrowing_params).fetchone()
    if borrowing is None:
        connection.close()
        return jsonify({"success": False, "message": "No active borrowing record was found for this book."}), 409

    returned_at = datetime.now().isoformat(timespec="seconds")
    assessed_fine = calculate_overdue_fine(borrowing["due_date"])
    connection.execute(
        "UPDATE borrowings SET returned_at = ?, fine_amount = ? WHERE id = ?",
        (returned_at, assessed_fine, borrowing["id"])
    )
    remaining_active = connection.execute("""
        SELECT COUNT(*) AS count FROM borrowings
        WHERE book_id = ? AND returned_at IS NULL AND id != ?
    """, (book_id, borrowing["id"])).fetchone()["count"]
    connection.execute(
        "UPDATE books SET status = 'Available', issued_to = '' WHERE id = ?",
        (book_id,)
    )
    connection.commit()
    connection.close()
    return jsonify({"success": True, "message": "Book returned successfully.",
                    "available_copies": book["total_copies"] - remaining_active})


@app.route("/api/borrowings/<int:borrowing_id>/return", methods=["PUT"])
def return_student_borrowing(borrowing_id):
    """Return the exact physical-copy loan selected in the student's My Books list."""
    data = request.get_json(silent=True) or {}
    try:
        student_id = int(data.get("student_id"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "A valid student is required to return a book."}), 400

    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    borrowing = connection.execute("""
        SELECT borrowings.id, borrowings.book_id, borrowings.due_date, books.total_copies
        FROM borrowings
        INNER JOIN books ON books.id = borrowings.book_id
        WHERE borrowings.id = ? AND borrowings.student_id = ? AND borrowings.returned_at IS NULL
    """, (borrowing_id, student_id)).fetchone()
    if borrowing is None:
        connection.close()
        return jsonify({"success": False, "message": "Active borrowing record not found."}), 404

    returned_at = datetime.now().isoformat(timespec="seconds")
    assessed_fine = calculate_overdue_fine(borrowing["due_date"])
    connection.execute(
        "UPDATE borrowings SET returned_at = ?, fine_amount = ? WHERE id = ?",
        (returned_at, assessed_fine, borrowing["id"]),
    )
    remaining_active = connection.execute("""
        SELECT COUNT(*) AS count FROM borrowings
        WHERE book_id = ? AND returned_at IS NULL
    """, (borrowing["book_id"],)).fetchone()["count"]
    connection.execute(
        "UPDATE books SET status = ?, issued_to = '' WHERE id = ?",
        ("Issued" if remaining_active >= borrowing["total_copies"] else "Available", borrowing["book_id"]),
    )
    connection.commit()
    connection.close()
    return jsonify({
        "success": True,
        "message": "Book returned successfully.",
        "available_copies": borrowing["total_copies"] - remaining_active,
    })


@app.route("/api/borrowings/<int:borrowing_id>/renew", methods=["PUT"])
def renew_borrowing(borrowing_id):
    """Renew an active loan only when it meets the library's renewal policy."""
    data = request.get_json(silent=True) or {}
    try:
        student_id = int(data.get("student_id"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "A valid student is required to renew a book."}), 400

    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    borrowing = connection.execute("""
        SELECT id, book_id, student_id, due_date, returned_at,
               COALESCE(renewal_count, 0) AS renewal_count
        FROM borrowings
        WHERE id = ? AND student_id = ?
    """, (borrowing_id, student_id)).fetchone()
    if borrowing is None or borrowing["returned_at"] is not None:
        connection.close()
        return jsonify({"success": False, "message": "An active borrowing record was not found."}), 404

    try:
        current_due_date = datetime.fromisoformat(borrowing["due_date"]).date()
    except (TypeError, ValueError):
        connection.close()
        return jsonify({"success": False, "message": "This borrowing has an invalid due date and cannot be renewed."}), 409

    today = datetime.now().date()
    if current_due_date < today:
        connection.close()
        return jsonify({"success": False, "message": "Overdue books must be returned before they can be renewed."}), 409
    if borrowing["renewal_count"] >= MAX_RENEWALS_PER_LOAN:
        connection.close()
        return jsonify({
            "success": False,
            "message": f"This book has already used its {MAX_RENEWALS_PER_LOAN} allowed renewal."
        }), 409

    waiting_reservation = connection.execute("""
        SELECT id FROM reservations
        WHERE book_id = ? AND student_id != ? AND status = 'Active'
        ORDER BY reserved_at ASC, id ASC
        LIMIT 1
    """, (borrowing["book_id"], student_id)).fetchone()
    if waiting_reservation is not None:
        connection.close()
        return jsonify({
            "success": False,
            "message": "This book is reserved by another student, so it cannot be renewed."
        }), 409

    # Renewing early never removes the remaining original loan time.
    new_due_date = (max(current_due_date, today) + timedelta(days=RENEWAL_PERIOD_DAYS)).isoformat()
    renewed_at = datetime.now().isoformat(timespec="seconds")
    new_renewal_count = borrowing["renewal_count"] + 1
    connection.execute("""
        UPDATE borrowings
        SET due_date = ?, renewal_count = ?, last_renewed_at = ?
        WHERE id = ?
    """, (new_due_date, new_renewal_count, renewed_at, borrowing["id"]))
    connection.commit()
    connection.close()
    return jsonify({
        "success": True,
        "message": f"Book renewed successfully. New due date: {new_due_date}.",
        "due_date": new_due_date,
        "renewal_count": new_renewal_count,
    })


# ---------------- RESERVATIONS ----------------

@app.route("/api/reservations", methods=["GET"])
def get_reservations():
    student_id = request.args.get("student_id", type=int)
    connection = get_db()
    query = """
        SELECT reservations.id, reservations.book_id, reservations.student_id,
               reservations.reserved_at, reservations.status,
               books.title, books.author, books.icon, books.total_copies,
               students.name AS student_name, students.username AS student_username,
               books.total_copies - COALESCE(active_loans.active_count, 0) AS available_copies
        FROM reservations
        INNER JOIN books ON books.id = reservations.book_id
        INNER JOIN students ON students.id = reservations.student_id
        LEFT JOIN (
            SELECT book_id, COUNT(*) AS active_count
            FROM borrowings
            WHERE returned_at IS NULL
            GROUP BY book_id
        ) AS active_loans ON active_loans.book_id = books.id
        WHERE reservations.status = 'Active'
    """
    query += " ORDER BY reservations.book_id ASC, reservations.reserved_at ASC, reservations.id ASC"
    rows = [dict(row) for row in connection.execute(query).fetchall()]
    connection.close()

    positions = {}
    for reservation in rows:
        book_id = reservation["book_id"]
        positions[book_id] = positions.get(book_id, 0) + 1
        reservation["queue_position"] = positions[book_id]
        reservation["is_ready"] = reservation["queue_position"] == 1 and reservation["available_copies"] > 0

    if student_id is not None:
        rows = [reservation for reservation in rows if reservation["student_id"] == student_id]
    return jsonify(rows)


@app.route("/api/books/<int:book_id>/reserve", methods=["POST"])
def reserve_book(book_id):
    data = request.get_json(silent=True) or {}
    try:
        student_id = int(data.get("student_id"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "A valid student is required to reserve a book."}), 400

    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    book = connection.execute("SELECT id, total_copies FROM books WHERE id = ?", (book_id,)).fetchone()
    if book is None:
        connection.close()
        return jsonify({"success": False, "message": "Book not found."}), 404

    student = connection.execute("SELECT id FROM students WHERE id = ?", (student_id,)).fetchone()
    if student is None:
        connection.close()
        return jsonify({"success": False, "message": "Student not found."}), 404

    active_loan = connection.execute("""
        SELECT id FROM borrowings
        WHERE book_id = ? AND student_id = ? AND returned_at IS NULL
    """, (book_id, student_id)).fetchone()
    if active_loan is not None:
        connection.close()
        return jsonify({"success": False, "message": "You already have a copy of this book."}), 409

    active_count = connection.execute("""
        SELECT COUNT(*) AS count FROM borrowings
        WHERE book_id = ? AND returned_at IS NULL
    """, (book_id,)).fetchone()["count"]
    if active_count < book["total_copies"]:
        connection.close()
        return jsonify({"success": False, "message": "A copy is available. Please issue the book instead."}), 409

    existing_reservation = connection.execute("""
        SELECT id FROM reservations
        WHERE book_id = ? AND student_id = ? AND status = 'Active'
    """, (book_id, student_id)).fetchone()
    if existing_reservation is not None:
        connection.close()
        return jsonify({"success": False, "message": "You already have an active reservation for this book."}), 409

    reserved_at = datetime.now().isoformat(timespec="seconds")
    try:
        connection.execute("""
            INSERT INTO reservations (book_id, student_id, reserved_at)
            VALUES (?, ?, ?)
        """, (book_id, student_id, reserved_at))
    except sqlite3.IntegrityError:
        connection.close()
        return jsonify({"success": False, "message": "You already have an active reservation for this book."}), 409

    queue_position = connection.execute("""
        SELECT COUNT(*) AS count FROM reservations
        WHERE book_id = ? AND status = 'Active'
    """, (book_id,)).fetchone()["count"]
    connection.commit()
    connection.close()
    return jsonify({
        "success": True,
        "message": f"Book reserved successfully. You are #{queue_position} in the waiting list.",
        "queue_position": queue_position
    }), 201


@app.route("/api/reservations/<int:reservation_id>/cancel", methods=["PUT"])
def cancel_reservation(reservation_id):
    data = request.get_json(silent=True) or {}
    try:
        student_id = int(data.get("student_id"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "A valid student is required to cancel a reservation."}), 400

    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    reservation = connection.execute("""
        SELECT id FROM reservations
        WHERE id = ? AND student_id = ? AND status = 'Active'
    """, (reservation_id, student_id)).fetchone()
    if reservation is None:
        connection.close()
        return jsonify({"success": False, "message": "Active reservation not found."}), 404

    connection.execute("""
        UPDATE reservations
        SET status = 'Cancelled', cancelled_at = ?
        WHERE id = ?
    """, (datetime.now().isoformat(timespec="seconds"), reservation_id))
    connection.commit()
    connection.close()
    return jsonify({"success": True, "message": "Reservation cancelled successfully."})


# ---------------- BOOK REQUESTS ----------------

@app.route("/api/book-requests", methods=["GET"])
def get_book_requests():
    student_id = request.args.get("student_id", type=int)
    connection = get_db()
    query = """
        SELECT book_requests.id, book_requests.student_id, book_requests.title,
               book_requests.author, book_requests.category, book_requests.reason,
               book_requests.status, book_requests.requested_at, book_requests.reviewed_at,
               book_requests.reviewer_note, students.name AS student_name,
               students.username AS student_username
        FROM book_requests
        INNER JOIN students ON students.id = book_requests.student_id
    """
    parameters = []
    if student_id is not None:
        query += " WHERE book_requests.student_id = ?"
        parameters.append(student_id)
    query += " ORDER BY CASE book_requests.status WHEN 'Pending' THEN 0 ELSE 1 END, book_requests.requested_at DESC, book_requests.id DESC"
    rows = connection.execute(query, parameters).fetchall()
    connection.close()
    return jsonify([dict(row) for row in rows])


@app.route("/api/book-requests", methods=["POST"])
def create_book_request():
    data = request.get_json(silent=True) or {}
    try:
        student_id = int(data.get("student_id"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "A valid student account is required."}), 400

    title = str(data.get("title", "") or "").strip()
    author = str(data.get("author", "") or "").strip()
    category = str(data.get("category", "Other") or "Other").strip()
    reason = str(data.get("reason", "") or "").strip()
    if len(title) < 2 or len(title) > 200:
        return jsonify({"success": False, "message": "Book title must contain between 2 and 200 characters."}), 400
    if len(author) > 200:
        return jsonify({"success": False, "message": "Author name is too long."}), 400
    if category not in BOOK_CATEGORIES:
        return jsonify({"success": False, "message": "Please choose a valid category."}), 400
    if len(reason) > 500:
        return jsonify({"success": False, "message": "Reason must be 500 characters or fewer."}), 400

    connection = get_db()
    student = connection.execute("SELECT id FROM students WHERE id = ?", (student_id,)).fetchone()
    if student is None:
        connection.close()
        return jsonify({"success": False, "message": "Student account not found."}), 404

    existing_book = connection.execute("""
        SELECT title FROM books
        WHERE lower(trim(title)) = lower(?)
        LIMIT 1
    """, (title,)).fetchone()
    if existing_book is not None:
        connection.close()
        return jsonify({
            "success": False,
            "message": f'"{existing_book["title"]}" is already in the catalogue. Use Browse Books or reserve it if all copies are issued.'
        }), 409

    pending_request = connection.execute("""
        SELECT id FROM book_requests
        WHERE student_id = ?
          AND lower(trim(title)) = lower(?)
          AND lower(trim(author)) = lower(?)
          AND status = 'Pending'
        LIMIT 1
    """, (student_id, title, author)).fetchone()
    if pending_request is not None:
        connection.close()
        return jsonify({"success": False, "message": "You already have a pending request for this book."}), 409

    requested_at = datetime.now().isoformat(timespec="seconds")
    try:
        cursor = connection.execute("""
            INSERT INTO book_requests (student_id, title, author, category, reason, requested_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (student_id, title, author, category, reason, requested_at))
        connection.commit()
    except sqlite3.IntegrityError:
        connection.close()
        return jsonify({"success": False, "message": "You already have a pending request for this book."}), 409
    request_id = cursor.lastrowid
    connection.close()
    return jsonify({
        "success": True,
        "message": "Book request submitted. The librarian will review it soon.",
        "request_id": request_id,
    }), 201


@app.route("/api/book-requests/<int:request_id>/review", methods=["PUT"])
def review_book_request(request_id):
    data = request.get_json(silent=True) or {}
    status = str(data.get("status", "") or "").strip().title()
    reviewer_note = str(data.get("reviewer_note", "") or "").strip()
    if status not in {"Approved", "Rejected"}:
        return jsonify({"success": False, "message": "Choose Approved or Rejected."}), 400
    if len(reviewer_note) > 300:
        return jsonify({"success": False, "message": "Review note must be 300 characters or fewer."}), 400
    if status == "Rejected" and not reviewer_note:
        return jsonify({"success": False, "message": "Add a short reason when rejecting a request."}), 400

    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    request_row = connection.execute(
        "SELECT id, status FROM book_requests WHERE id = ?", (request_id,)
    ).fetchone()
    if request_row is None:
        connection.close()
        return jsonify({"success": False, "message": "Book request not found."}), 404
    if request_row["status"] != "Pending":
        connection.close()
        return jsonify({"success": False, "message": "This request has already been reviewed."}), 409

    reviewed_at = datetime.now().isoformat(timespec="seconds")
    connection.execute("""
        UPDATE book_requests
        SET status = ?, reviewer_note = ?, reviewed_at = ?
        WHERE id = ?
    """, (status, reviewer_note, reviewed_at, request_id))
    connection.commit()
    connection.close()
    message = "Request approved. Add the book from Manage Books when it is acquired." if status == "Approved" else "Request rejected and the student can view the reason."
    return jsonify({"success": True, "message": message})


# ---------------- BORROWING HISTORY & REPORTS ----------------

@app.route("/api/borrowings", methods=["GET"])
def get_borrowings():
    student_id = request.args.get("student_id", type=int)
    connection = get_db()
    query = """
        WITH borrowing_details AS (
            SELECT borrowings.id, borrowings.book_id, borrowings.student_id,
                   borrowings.borrower_name, borrowings.issued_at, borrowings.due_date,
                   borrowings.returned_at, COALESCE(borrowings.renewal_count, 0) AS renewal_count,
                   borrowings.last_renewed_at, books.title, books.author, books.category, books.icon,
                   COALESCE(students.name, borrowings.borrower_name) AS student_name,
                   COALESCE(borrowings.fine_paid_amount, 0) AS fine_paid_amount,
                   borrowings.fine_paid_at,
                   COALESCE(borrowings.fine_payment_mode, '') AS fine_payment_mode,
                   COALESCE(borrowings.fine_receipt_number, '') AS fine_receipt_number,
                   borrowings.fine_payment_requested_at,
                   COALESCE(borrowings.fine_payment_request_mode, '') AS fine_payment_request_mode,
                   CASE
                       WHEN borrowings.returned_at IS NULL
                        AND date(borrowings.due_date) < date('now', 'localtime')
                       THEN CAST(julianday(date('now', 'localtime')) - julianday(date(borrowings.due_date)) AS INTEGER) * ?
                       ELSE COALESCE(borrowings.fine_amount, 0)
                   END AS fine_amount,
               CASE
                   WHEN borrowings.returned_at IS NULL
                    AND date(borrowings.due_date) < date('now', 'localtime')
                   THEN 1 ELSE 0
               END AS is_overdue,
               CASE
                   WHEN borrowings.returned_at IS NULL
                    AND date(borrowings.due_date) < date('now', 'localtime')
                   THEN CAST(julianday(date('now', 'localtime')) - julianday(date(borrowings.due_date)) AS INTEGER)
                   ELSE 0
               END AS overdue_days
            FROM borrowings
            INNER JOIN books ON books.id = borrowings.book_id
            LEFT JOIN students ON students.id = borrowings.student_id
        )
        SELECT borrowing_details.*,
               MAX(0, fine_amount - fine_paid_amount) AS fine_due_amount,
               CASE
                   WHEN fine_amount <= 0 THEN 'No Fine'
                   WHEN fine_paid_amount >= fine_amount THEN 'Paid'
                   WHEN fine_payment_requested_at IS NOT NULL THEN 'Awaiting Confirmation'
                   ELSE 'Unpaid'
               END AS fine_payment_status
        FROM borrowing_details
    """
    params = [FINE_PER_DAY]
    if student_id is not None:
        query += " WHERE student_id = ?"
        params.append(student_id)
    query += " ORDER BY issued_at DESC, id DESC"
    history = connection.execute(query, params).fetchall()
    connection.close()
    return jsonify([dict(row) for row in history])


@app.route("/api/borrowings/<int:borrowing_id>/fine-payment-request", methods=["POST"])
def request_fine_payment(borrowing_id):
    data = request.get_json(silent=True) or {}
    try:
        student_id = int(data.get("student_id"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "A valid student is required to request payment."}), 400
    payment_mode = str(data.get("payment_mode", "") or "").strip().upper()
    if payment_mode not in {"CASH", "UPI"}:
        return jsonify({"success": False, "message": "Choose Cash or UPI payment."}), 400

    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    borrowing = connection.execute("""
        SELECT id, returned_at, fine_amount, fine_paid_amount, fine_payment_requested_at
        FROM borrowings
        WHERE id = ? AND student_id = ?
    """, (borrowing_id, student_id)).fetchone()
    if borrowing is None:
        connection.close()
        return jsonify({"success": False, "message": "Borrowing record not found."}), 404
    if borrowing["returned_at"] is None:
        connection.close()
        return jsonify({"success": False, "message": "Return the book before paying its fine."}), 409
    if float(borrowing["fine_amount"] or 0) <= float(borrowing["fine_paid_amount"] or 0):
        connection.close()
        return jsonify({"success": False, "message": "No unpaid fine remains for this borrowing."}), 409
    if borrowing["fine_payment_requested_at"] is not None:
        connection.close()
        return jsonify({"success": False, "message": "Your payment request is already awaiting librarian confirmation."}), 409

    requested_at = datetime.now().isoformat(timespec="seconds")
    connection.execute("""
        UPDATE borrowings
        SET fine_payment_requested_at = ?, fine_payment_request_mode = ?
        WHERE id = ?
    """, (requested_at, payment_mode, borrowing_id))
    connection.commit()
    connection.close()
    return jsonify({
        "success": True,
        "message": f"{payment_mode} payment request sent. Please complete payment with the librarian for confirmation.",
    }), 201


@app.route("/api/borrowings/<int:borrowing_id>/fine-payment", methods=["PUT"])
def collect_fine_payment(borrowing_id):
    data = request.get_json(silent=True) or {}
    payment_mode = str(data.get("payment_mode", "") or "").strip().upper()
    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    borrowing = connection.execute(
        """SELECT id, returned_at, fine_amount, fine_paid_amount,
                  fine_payment_requested_at, fine_payment_request_mode
           FROM borrowings WHERE id = ?""",
        (borrowing_id,)
    ).fetchone()
    if borrowing is None:
        connection.close()
        return jsonify({"success": False, "message": "Borrowing record not found."}), 404
    if borrowing["returned_at"] is None:
        connection.close()
        return jsonify({"success": False, "message": "Return the book before collecting its fine."}), 409

    fine_amount = float(borrowing["fine_amount"] or 0)
    fine_paid_amount = float(borrowing["fine_paid_amount"] or 0)
    outstanding_fine = max(0, fine_amount - fine_paid_amount)
    if outstanding_fine <= 0:
        connection.close()
        return jsonify({"success": False, "message": "No unpaid fine remains for this borrowing."}), 409

    if payment_mode not in {"CASH", "UPI"}:
        payment_mode = borrowing["fine_payment_request_mode"] or "CASH"
    paid_at = datetime.now().isoformat(timespec="seconds")
    receipt_number = f"FINE-{datetime.now():%Y%m%d}-{borrowing_id:05d}"
    connection.execute(
        """UPDATE borrowings
           SET fine_paid_amount = ?, fine_paid_at = ?, fine_payment_mode = ?,
               fine_receipt_number = ?
           WHERE id = ?""",
        (fine_amount, paid_at, payment_mode, receipt_number, borrowing_id)
    )
    connection.commit()
    connection.close()
    return jsonify({
        "success": True,
        "message": f"Fine payment of ₹{outstanding_fine:.0f} confirmed successfully.",
        "amount_collected": outstanding_fine,
        "paid_at": paid_at,
        "receipt_number": receipt_number,
    })


@app.route("/api/reports/summary", methods=["GET"])
def get_report_summary():
    connection = get_db()
    summary = connection.execute("""
        SELECT
            COUNT(*) AS total_transactions,
            SUM(CASE WHEN returned_at IS NULL THEN 1 ELSE 0 END) AS active_loans,
            SUM(CASE WHEN returned_at IS NOT NULL THEN 1 ELSE 0 END) AS returned_books,
            SUM(CASE
                WHEN returned_at IS NULL AND date(due_date) < date('now', 'localtime')
                THEN 1 ELSE 0
            END) AS overdue_books,
            SUM(COALESCE(fine_paid_amount, 0)) AS total_fine_collected,
            SUM(CASE
                WHEN returned_at IS NULL AND date(due_date) < date('now', 'localtime')
                THEN MAX(0, CAST(julianday(date('now', 'localtime')) - julianday(date(due_date)) AS INTEGER) * ? - COALESCE(fine_paid_amount, 0))
                ELSE MAX(0, COALESCE(fine_amount, 0) - COALESCE(fine_paid_amount, 0))
            END) AS pending_fine
        FROM borrowings
    """, (FINE_PER_DAY,)).fetchone()
    popular_books = connection.execute("""
        SELECT books.title, books.author, books.icon, COUNT(borrowings.id) AS issue_count
        FROM borrowings
        INNER JOIN books ON books.id = borrowings.book_id
        GROUP BY books.id
        ORDER BY issue_count DESC, books.title ASC
        LIMIT 5
    """).fetchall()
    connection.close()
    return jsonify({
        "total_transactions": summary["total_transactions"] or 0,
        "active_loans": summary["active_loans"] or 0,
        "returned_books": summary["returned_books"] or 0,
        "overdue_books": summary["overdue_books"] or 0,
        "total_fine_collected": summary["total_fine_collected"] or 0,
        "pending_fine": summary["pending_fine"] or 0,
        "popular_books": [dict(book) for book in popular_books]
    })


@app.route("/api/activity", methods=["GET"])
def get_recent_activity():
    connection = get_db()
    activity = connection.execute("""
        SELECT * FROM (
            SELECT
                borrowings.issued_at AS activity_at,
                'issued' AS activity_type,
                books.title AS book_title,
                books.icon AS book_icon,
                COALESCE(students.name, borrowings.borrower_name, 'Student') AS person_name
            FROM borrowings
            INNER JOIN books ON books.id = borrowings.book_id
            LEFT JOIN students ON students.id = borrowings.student_id

            UNION ALL

            SELECT
                borrowings.returned_at AS activity_at,
                'returned' AS activity_type,
                books.title AS book_title,
                books.icon AS book_icon,
                COALESCE(students.name, borrowings.borrower_name, 'Student') AS person_name
            FROM borrowings
            INNER JOIN books ON books.id = borrowings.book_id
            LEFT JOIN students ON students.id = borrowings.student_id
            WHERE borrowings.returned_at IS NOT NULL
        )
        ORDER BY activity_at DESC
        LIMIT 8
    """).fetchall()
    connection.close()
    return jsonify([dict(row) for row in activity])


# ---------------- STUDENTS ----------------

@app.route("/api/students", methods=["GET"])
def get_students():
    connection = get_db()
    students = connection.execute("""
        SELECT students.id, students.name, students.username, students.roll_number,
               students.phone, students.course, students.semester,
               COUNT(borrowings.id) AS active_borrowings
        FROM students
        LEFT JOIN borrowings
          ON borrowings.student_id = students.id AND borrowings.returned_at IS NULL
        GROUP BY students.id
        ORDER BY students.id DESC
    """).fetchall()
    connection.close()
    return jsonify([dict(s) for s in students])


@app.route("/api/students", methods=["POST"])
def add_student():
    data = request.get_json()

    name = data.get("name", "").strip()
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()

    if not name or not username or not password:
        return jsonify({"success": False, "message": "Name, username and password are required."}), 400

    connection = get_db()
    try:
        connection.execute(
            "INSERT INTO students (name, username, password) VALUES (?, ?, ?)",
            (name, username, password)
        )
        connection.commit()
    except sqlite3.IntegrityError:
        connection.close()
        return jsonify({"success": False, "message": "Username already exists."}), 400

    connection.close()
    return jsonify({"success": True, "message": "Student added successfully."}), 201


@app.route("/api/students/<int:student_id>/borrowings", methods=["GET"])
def get_student_borrowings(student_id):
    connection = get_db()
    borrowings = connection.execute("""
        SELECT borrowings.id, borrowings.book_id, borrowings.issued_at, borrowings.due_date,
               borrowings.returned_at, COALESCE(borrowings.renewal_count, 0) AS renewal_count,
               borrowings.last_renewed_at, borrowings.fine_amount, borrowings.fine_paid_amount,
               books.title, books.author, books.category, books.icon, books.price,
               CASE
                   WHEN borrowings.returned_at IS NULL
                    AND date(borrowings.due_date) < date('now', 'localtime')
                   THEN CAST(julianday(date('now', 'localtime')) - julianday(date(borrowings.due_date)) AS INTEGER) * ?
                   ELSE COALESCE(borrowings.fine_amount, 0)
               END AS current_fine,
               CASE
                   WHEN borrowings.returned_at IS NULL
                    AND date(borrowings.due_date) < date('now', 'localtime')
                   THEN 1 ELSE 0
               END AS is_overdue
        FROM borrowings
        INNER JOIN books ON books.id = borrowings.book_id
        WHERE borrowings.student_id = ?
        ORDER BY borrowings.issued_at DESC
    """, (FINE_PER_DAY, student_id)).fetchall()
    connection.close()
    return jsonify([dict(b) for b in borrowings])


@app.route("/api/students/<int:student_id>/profile", methods=["PUT"])
def update_student_profile(student_id):
    profile, error = validate_student_profile(request.get_json(silent=True))
    if error:
        return jsonify({"success": False, "message": error}), 400

    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    student = connection.execute(
        "SELECT id FROM students WHERE id = ?", (student_id,)
    ).fetchone()
    if student is None:
        connection.close()
        return jsonify({"success": False, "message": "Student account not found."}), 404

    try:
        connection.execute("""
            UPDATE students
            SET name = ?, roll_number = ?, phone = ?, course = ?, semester = ?
            WHERE id = ?
        """, (
            profile["name"], profile["roll_number"], profile["phone"],
            profile["course"], profile["semester"], student_id
        ))
    except sqlite3.IntegrityError:
        connection.close()
        return jsonify({"success": False, "message": "This roll number is already used by another student."}), 409

    # Keep currently issued-book labels in sync when the student changes name.
    connection.execute("""
        UPDATE borrowings SET borrower_name = ?
        WHERE student_id = ? AND returned_at IS NULL
    """, (profile["name"], student_id))
    connection.execute("""
        UPDATE books SET issued_to = ?
        WHERE id IN (
            SELECT book_id FROM borrowings
            WHERE student_id = ? AND returned_at IS NULL
        )
    """, (profile["name"], student_id))

    connection.commit()
    updated_student = connection.execute("""
        SELECT id, name, username, roll_number, phone, course, semester
        FROM students WHERE id = ?
    """, (student_id,)).fetchone()
    connection.close()
    return jsonify({
        "success": True,
        "message": "Profile updated successfully.",
        "student": dict(updated_student)
    }), 200


@app.route("/api/students/<int:student_id>", methods=["PUT"])
def admin_edit_student(student_id):
    data = request.get_json()
    roll_number = data.get("roll_number", "").strip()
    phone = data.get("phone", "").strip()
    course = data.get("course", "").strip()
    semester = data.get("semester", "").strip()

    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    student = connection.execute(
        "SELECT id FROM students WHERE id = ?", (student_id,)
    ).fetchone()
    if student is None:
        connection.close()
        return jsonify({"success": False, "message": "Student account not found."}), 404

    connection.execute("""
        UPDATE students
        SET roll_number = ?, phone = ?, course = ?, semester = ?
        WHERE id = ?
    """, (roll_number, phone, course, semester, student_id))

    connection.commit()
    connection.close()
    return jsonify({"success": True, "message": "Student academic information updated successfully."}), 200


@app.route("/api/students/<int:student_id>", methods=["DELETE"])
def delete_student(student_id):
    connection = get_db()
    connection.execute("BEGIN IMMEDIATE")
    student = connection.execute(
        "SELECT id, name FROM students WHERE id = ?", (student_id,)
    ).fetchone()
    if student is None:
        connection.close()
        return jsonify({"success": False, "message": "Student account not found."}), 404

    # Check if student has active borrowings
    active_borrowings = connection.execute(
        "SELECT COUNT(*) FROM borrowings WHERE student_id = ? AND returned_at IS NULL",
        (student_id,)
    ).fetchone()[0]
    if active_borrowings > 0:
        connection.close()
        return jsonify({"success": False, "message": "Cannot delete student with active borrowings. Please return all books first."}), 400

    # Delete student's reservations
    connection.execute("DELETE FROM reservations WHERE student_id = ?", (student_id,))
    # Delete student's borrowing history
    connection.execute("DELETE FROM borrowings WHERE student_id = ?", (student_id,))
    # Delete student
    connection.execute("DELETE FROM students WHERE id = ?", (student_id,))

    connection.commit()
    connection.close()
    return jsonify({"success": True, "message": "Student deleted successfully."}), 200


@app.route("/api/student-login", methods=["POST"])
def student_login():
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()

    connection = get_db()
    student = connection.execute(
        """SELECT id, name, username, roll_number, phone, course, semester
           FROM students WHERE username = ? AND password = ?""",
        (username, password)
    ).fetchone()
    connection.close()

    if student is None:
        return jsonify({"success": False, "message": "Invalid username or password."}), 401

    return jsonify({"success": True, "message": "Login successful.", "student": dict(student)})


# ---------------- START SERVER ----------------

if __name__ == "__main__":
    init_database()
    print("====================================")
    print(" Library Management System Backend")
    print(" Server running on port 5000")
    print("====================================")
    app.run(host="127.0.0.1", port=5000, debug=True)
