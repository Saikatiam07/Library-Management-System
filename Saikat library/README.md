# BookVerse Library Management System

BookVerse is a college-project Library Management System built with a vanilla HTML/CSS/JavaScript frontend, a Flask API, and an SQLite database.

## Prerequisites

- Python 3.10 or newer
- Visual Studio Code with the Live Server extension (recommended for the frontend)

## Run the project

Open PowerShell in this folder and run:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

The API will start at `http://127.0.0.1:5000`.

In a second terminal, open `index.html` with VS Code Live Server. The frontend calls the API at `http://127.0.0.1:5000/api`.

## Demo account

- Admin username: `admin`
- Admin password: `1234`

Students can create an account from the Student Login screen.

## Implemented demo features

- Student registration and login, plus an admin demo login
- Browse/search books by category and subcategory
- Add, edit, issue, return, and safely delete books
- Student-specific "My Books" view with issue and due dates
- Loan history that keeps returned transactions
- Overdue-book indicators and ₹2-per-day fine calculation
- Fine-payment collection for returned overdue books, with payment status and date
- Admin reports for transactions, active loans, returns, overdue books, pending/collected fines, and most-issued books
- Student search with active-loan counts

## Sample book data

The included `library.db` already contains sample books. If you need to reset only the book catalogue, run:

```powershell
python seed_books.py
```

> Warning: `seed_books.py` deletes all existing book records before adding its sample data. It does not delete student records.

## Current project structure

```text
index.html     Frontend markup
style.css      Existing BookVerse styling
script.js      Frontend behaviour and API calls
app.py         Flask API and SQLite setup
library.db     SQLite database
seed_books.py  Sample-book reset script
```
