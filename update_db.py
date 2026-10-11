from database import engine
from sqlalchemy import text

with engine.connect() as conn:
    conn.execute(text("ALTER TABLE admins ADD COLUMN IF NOT EXISTS permission_mode VARCHAR(20) DEFAULT 'EDIT_VIEW';"))
    conn.commit()
    print("Column permission_mode added successfully!")