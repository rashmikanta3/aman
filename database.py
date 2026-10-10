import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from dotenv import load_dotenv
load_dotenv()

# Uses SQLite by default or reads your PostgreSQL connection string
DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL:
    DATABASE_URL = DATABASE_URL.strip().strip('"').strip("'")
else:
    raise ValueError("DATABASE_URL environment variable is not set or empty!")

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,    # test each connection before using it, replace if dead
    pool_recycle=300,      # drop connections older than 5 minutes
    pool_size=5,
    max_overflow=5,
    pool_timeout=30,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()