import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from dotenv import load_dotenv
load_dotenv()

# Configuration (loads from environment variables, or uses your exact fallbacks)
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.zoho.in")
SMTP_PORT = int(os.getenv("SMTP_PORT", 465))
SMTP_USER = os.getenv("SMTP_USER", "rashmikantaa@zohomail.in")
SMTP_PASS = os.getenv("SMTP_PASS",)  # Paste your generated app password here
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER)
RECIPIENT_EMAIL = "rashmikanta3@gmail.com"  # Send a test email to yourself[cite: 2]

# Construct the email messagep
msg = MIMEMultipart()
msg["From"] = SMTP_FROM
msg["To"] = RECIPIENT_EMAIL
msg["Subject"] = "Zoho SMTP Connection Test"

body = "Hello!\n\nThis is a test email sent from Python via Zoho SMTP (Port 465 SSL)."
msg.attach(MIMEText(body, "plain"))

try:
    print(f"Connecting to {SMTP_HOST}:{SMTP_PORT} via SSL...")
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as server:
        # Optional: uncomment next line to see the full raw SMTP handshake in the console
        # server.set_debuglevel(1)

        print("Authenticating...")
        server.login(SMTP_USER, SMTP_PASS)

        print(f"Sending test email to {RECIPIENT_EMAIL}...")
        server.send_message(msg)

    print("SUCCESS: Email sent successfully! Check your inbox.")

except smtplib.SMTPAuthenticationError as auth_err:
    print(f"AUTHENTICATION FAILED: Check your email and 12-digit app password. Details: {auth_err}")
except Exception as e:
    print(f"ERROR: An error occurred while sending email: {e}")