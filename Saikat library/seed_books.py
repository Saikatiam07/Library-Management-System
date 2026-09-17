"""
Run this to load 40 books into library.db (run once).
Usage: py seed_books.py
Safe to re-run: it clears existing books first, so no duplicates.
"""

import sqlite3
from pathlib import Path

DATABASE = Path("library.db")

def icon_for_category(category):
    mapping = {"Comics": "🦸", "Science": "🔬", "Programming": "💻", "Novels": "📖"}
    return mapping.get(category, "📚")


# (title, author, category, subcategory, price_in_rupees)
books = [
    # ---------------- COMICS: MARVEL ----------------
    ("Spider-Man: Into the Spider-Verse", "Marvel Comics", "Comics", "Marvel", 299),
    ("Avengers: Infinity Gauntlet", "Marvel Comics", "Comics", "Marvel", 349),
    ("Iron Man: Extremis", "Marvel Comics", "Comics", "Marvel", 279),
    ("Captain America: Civil War", "Marvel Comics", "Comics", "Marvel", 319),
    ("X-Men: Days of Future Past", "Marvel Comics", "Comics", "Marvel", 299),

    # ---------------- COMICS: DC ----------------
    ("Batman: The Dark Knight Returns", "DC Comics", "Comics", "DC", 349),
    ("Justice League: Origin", "DC Comics", "Comics", "DC", 299),
    ("Superman: Red Son", "DC Comics", "Comics", "DC", 289),
    ("Watchmen", "Alan Moore", "Comics", "DC", 399),
    ("Batman: Year One", "DC Comics", "Comics", "DC", 309),

    # ---------------- SCIENCE ----------------
    ("NCERT Mathematics Class 12", "NCERT", "Science", "Mathematics", 150),
    ("Higher Algebra", "Hall & Knight", "Science", "Mathematics", 220),
    ("Concepts of Physics Vol 1", "H.C. Verma", "Science", "Physics", 250),
    ("Concepts of Physics Vol 2", "H.C. Verma", "Science", "Physics", 250),
    ("NCERT Chemistry Class 12", "NCERT", "Science", "Chemistry", 150),
    ("Organic Chemistry", "Morrison & Boyd", "Science", "Chemistry", 599),
    ("A Brief History of Time", "Stephen Hawking", "Science", "General", 399),
    ("The Selfish Gene", "Richard Dawkins", "Science", "General", 349),
    ("Problems in General Physics", "I.E. Irodov", "Science", "Physics", 450),
    ("Fundamentals of Physics", "Halliday, Resnick & Walker", "Science", "Physics", 699),

    # ---------------- PROGRAMMING ----------------
    ("Introduction to Algorithms", "Thomas H. Cormen", "Programming", "General", 899),
    ("Python Crash Course", "Eric Matthes", "Programming", "Python", 599),
    ("The C Programming Language", "Kernighan & Ritchie", "Programming", "C / C++", 399),
    ("Java: The Complete Reference", "Herbert Schildt", "Programming", "Java", 699),
    ("JavaScript: The Good Parts", "Douglas Crockford", "Programming", "JavaScript", 399),
    ("Clean Code", "Robert C. Martin", "Programming", "General", 549),
    ("Automate the Boring Stuff with Python", "Al Sweigart", "Programming", "Python", 499),
    ("Data Structures and Algorithms Made Easy", "Narasimha Karumanchi", "Programming", "General", 449),
    ("You Don't Know JS", "Kyle Simpson", "Programming", "JavaScript", 349),
    ("Design Patterns", "Gang of Four", "Programming", "General", 599),

    # ---------------- NOVELS ----------------
    ("To Kill a Mockingbird", "Harper Lee", "Novels", "Classic", 299),
    ("1984", "George Orwell", "Novels", "Classic", 249),
    ("Pride and Prejudice", "Jane Austen", "Novels", "Classic", 279),
    ("The Great Gatsby", "F. Scott Fitzgerald", "Novels", "Classic", 259),
    ("The Alchemist", "Paulo Coelho", "Novels", "Fiction", 299),
    ("The Kite Runner", "Khaled Hosseini", "Novels", "Fiction", 349),
    ("Harry Potter and the Sorcerer's Stone", "J.K. Rowling", "Novels", "Fiction", 399),
    ("The Da Vinci Code", "Dan Brown", "Novels", "Fiction", 349),
    ("Five Point Someone", "Chetan Bhagat", "Novels", "Fiction", 199),
    ("Wings of Fire", "A.P.J. Abdul Kalam", "Novels", "General", 249),
]

connection = sqlite3.connect(DATABASE)
connection.execute("DELETE FROM books")

for title, author, category, subcategory, price in books:
    icon = icon_for_category(category)
    connection.execute(
        """INSERT INTO books (title, author, category, subcategory, price, status, icon, issued_to)
           VALUES (?, ?, ?, ?, ?, 'Available', ?, '')""",
        (title, author, category, subcategory, price, icon)
    )

connection.commit()
connection.close()
print(f"✅ {len(books)} books added successfully to library.db")