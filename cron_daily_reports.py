from datetime import date, timedelta
from database import SessionLocal
import mailer

def run_daily_reports():
    db = SessionLocal()
    yesterday = date.today() - timedelta(days=1)
    print(f"[{date.today()}] Sending previous day performance for {yesterday}...")

    # 1. Send ALL circles combined report to Head Office
    print("Dispatching combined report to Head Office...")
    mailer.send_report_email(db, yesterday, scope="ALL")

    # 2. Send isolated reports to individual circles
    for circle in mailer.SUPPORTED_CIRCLES:
        print(f"Dispatching report for {circle}...")
        mailer.send_report_email(db, yesterday, scope=circle)

    db.close()
    print("All daily reports completed.")

if __name__ == "__main__":
    run_daily_reports()