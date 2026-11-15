"""SQLite ticket timeline with conservative network rechecks and optional real mail."""
import asyncio
import email
import email.policy
import imaplib
import json
import os
import re
import smtplib
import sqlite3
import ssl
from datetime import datetime, timezone, timedelta
from email.message import EmailMessage
from pathlib import Path

from .net import FetchError
from .pages import extract_images


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def parse_time(value):
    try:
        if isinstance(value, (float, int)):
            return datetime.fromtimestamp(value / 1000, timezone.utc)
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except (ValueError, TypeError, OverflowError, OSError):
        return None


def classify_reply(text: str) -> str:
    """Conservative rules: requests, negation and future promises are not removal confirmations."""
    clean = text.lower().replace('’', "'")
    # Do not classify quoted original notices as a provider's reply.
    clean = '\n'.join(line for line in clean.splitlines() if not line.lstrip().startswith('>'))
    clean = re.split(r'\bon .{0,100}wrote:|-----original message-----', clean)[0]
    if re.search(r'\b(?:not|never|cannot|can\'t|unable to|won\'t|will not|hasn\'t|haven\'t|isn\'t|wasn\'t)\b.{0,35}\b(?:remov\w*|delet\w*|disabl\w*|take|taken)', clean):
        if re.search(r'\b(?:need|provide|missing|additional|more|verify)\b.{0,60}\b(?:info|information|evidence|detail|identity|document|url)', clean):
            return 'needs_info'
        return 'rejected'
    if re.search(r'\b(?:reject(?:ed)?|denied|declin(?:e|ed)|invalid|no violation|not a violation|not infringing|counter.?notice)\b', clean):
        return 'rejected'
    if re.search(r'\b(?:need|provide|missing|additional|more|verify|confirm)\b.{0,60}\b(?:info|information|evidence|detail|identity|document|url|ownership)', clean):
        return 'needs_info'
    if re.search(r'\b(?:will|plan to|intend to|going to|may|might|can|could|should|please|request)\b.{0,35}\b(?:remov\w*|delet\w*|disabl\w*|take|taken)', clean):
        return 'acknowledged'
    if re.search(r'\b(?:has been|have been|was|were|is now|are now|we have|we already|successfully)\s+(?:permanently\s+)?(?:removed|deleted|disabled|taken down)\b', clean):
        return 'removed'
    if re.search(r'\b(?:received|acknowledge|reviewing|investigating|under review|looking into|processing)\b', clean):
        return 'acknowledged'
    return 'unknown'


class TicketStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, record TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS mail_seen (uid TEXT PRIMARY KEY)')

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.execute('PRAGMA journal_mode=WAL')
        return db

    def get(self, ticket_id):
        with self.connect() as db:
            row = db.execute('SELECT record FROM tickets WHERE id=?', (ticket_id,)).fetchone()
        if not row:
            raise FetchError(404, 'Ticket not found.')
        return json.loads(row[0])

    def list(self, ids=None):
        with self.connect() as db:
            rows = db.execute('SELECT record FROM tickets ORDER BY rowid DESC').fetchall()
        return [record for row in rows if (record := json.loads(row[0]))['id'] in ids] if ids is not None else [json.loads(row[0]) for row in rows]

    def upsert(self, data):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT record FROM tickets WHERE id=?', (data['id'],)).fetchone()
            record = json.loads(previous[0]) if previous else {
                'events': [{'at': data.get('createdAt') or now_iso(), 'type': 'created', 'detail': {}}], 'status': 'ready'}
            original_created = record.get('createdAt')
            record.update(data)
            if original_created is not None:
                record['createdAt'] = original_created
            db.execute('INSERT INTO tickets VALUES (?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record',
                       (record['id'], json.dumps(record)))
        return record

    def event(self, ticket_id, kind, detail, at=None, status=None):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT record FROM tickets WHERE id=?', (ticket_id,)).fetchone()
            if not row:
                raise FetchError(404, 'Ticket not found.')
            record = json.loads(row[0])
            record['events'].append({'at': at or now_iso(), 'type': kind, 'detail': detail})
            if status:
                record['status'] = status
            db.execute('UPDATE tickets SET record=? WHERE id=?', (json.dumps(record), ticket_id))
        return record


async def recheck(store, ticket_id, fetcher):
    ticket = store.get(ticket_id)
    image_url = ticket.get('imageUrl')
    target = image_url or ticket['pageUrl']
    try:
        response = await fetcher.fetch(target, headers_only_images=True)
        if response.status in (404, 410, 451):
            return store.event(ticket_id, 'removed', {'status': response.status, 'via': 'http'}, status='removed')
        if response.status != 200:
            return store.event(ticket_id, 'unknown', {'status': response.status, 'reason': 'Upstream did not confirm availability.'})
        # A positive image fetch means present. A page-only ticket cannot prove a particular image disappeared.
        if image_url:
            page = await fetcher.fetch(ticket['pageUrl'])
            content_type = page.headers.get('content-type', '').lower()
            if page.status == 200 and ('text/html' in content_type or 'application/xhtml+xml' in content_type):
                if re.search(r'captcha|challenge-platform|verify you are human|sign in|log in|access denied|enable javascript', page.text, re.I):
                    return store.event(ticket_id, 'unknown', {'reason': 'The page may be a challenge or login response.'})
                images = extract_images(page.text, page.url, cap=None, all_sources=True)
                if not images:
                    return store.event(ticket_id, 'unknown', {'reason': 'The page does not expose image listings.'})
                if image_url not in [image['url'] for image in images]:
                    return store.event(ticket_id, 'removed', {'status': 200, 'via': 'not-listed-on-page'}, status='removed')
        return store.event(ticket_id, 'present', {'status': response.status})
    except (FetchError, OSError, TimeoutError) as exc:
        return store.event(ticket_id, 'unknown', {'reason': str(exc)})


async def scheduler_tick(store, fetcher, now=None):
    now = now or datetime.now(timezone.utc)
    for ticket in store.list():
        if ticket['status'] not in ('sent', 'acknowledged'):
            continue
        updated = await recheck(store, ticket['id'], fetcher)
        sent = next((parse_time(event['at']) for event in reversed(updated['events']) if event['type'] == 'sent'), None)
        if updated['status'] != 'removed' and sent and now - sent >= timedelta(hours=48):
            if not any(event['type'] == 'overdue' for event in updated['events']):
                store.event(ticket['id'], 'overdue', {'hours': 48}, at=now.isoformat())


def smtp_configured():
    return bool(os.getenv('SMTP_HOST') and os.getenv('SMTP_FROM'))


def send_smtp(ticket_id, payload):
    if not smtp_configured():
        raise FetchError(503, 'SMTP is not configured; no message was sent.')
    message = EmailMessage()
    message['From'] = os.environ['SMTP_FROM']
    message['To'] = ', '.join(payload['to'])
    message['Subject'] = f"[Veil:{ticket_id}] {payload['subject']}"
    if payload.get('replyTo'):
        message['Reply-To'] = payload['replyTo']
    message.set_content(payload['text'])
    if payload.get('evidenceHtml'):
        message.add_alternative(payload['evidenceHtml'], subtype='html')
    port = int(os.getenv('SMTP_PORT', '587'))
    smtp_type = smtplib.SMTP_SSL if port == 465 else smtplib.SMTP
    try:
        with smtp_type(os.environ['SMTP_HOST'], port, timeout=20) as client:
            if port != 465:
                client.starttls(context=ssl.create_default_context())
            if os.getenv('SMTP_USER'):
                client.login(os.environ['SMTP_USER'], os.getenv('SMTP_PASS', ''))
            refused = client.send_message(message)
            if refused:
                raise FetchError(502, 'Some recipients were refused; review the mail provider before retrying.')
    except (smtplib.SMTPException, OSError) as exc:
        raise FetchError(502, 'SMTP failed; successful delivery was not confirmed.') from exc


def imap_configured():
    return all(os.getenv('IMAP_' + field) for field in ('HOST', 'USER', 'PASS'))


def poll_imap(store):
    if not imap_configured():
        return
    with imaplib.IMAP4_SSL(os.environ['IMAP_HOST'], int(os.getenv('IMAP_PORT', '993')), timeout=20) as client:
        client.login(os.environ['IMAP_USER'], os.environ['IMAP_PASS'])
        client.select(os.getenv('IMAP_FOLDER', 'INBOX'), readonly=True)
        status, ids = client.uid('search', None, 'ALL')
        if status != 'OK':
            return
        validity = (client.response('UIDVALIDITY')[1] or [b'unknown'])[0].decode()
        for uid in (ids[0] or b'').split()[-100:]:
            key = ':'.join((os.environ['IMAP_HOST'], os.environ['IMAP_USER'],
                            os.getenv('IMAP_FOLDER', 'INBOX'), validity, uid.decode()))
            with store.connect() as db:
                if db.execute('SELECT 1 FROM mail_seen WHERE uid=?', (key,)).fetchone():
                    continue
            status, chunks = client.uid('fetch', uid, '(BODY.PEEK[])')
            if status != 'OK':
                continue
            raw = next((chunk[1] for chunk in chunks if isinstance(chunk, tuple)), None)
            if raw is None or len(raw) > 1024 * 1024:
                continue
            message = email.message_from_bytes(raw, policy=email.policy.default)
            match = re.search(r'\[Veil:([A-Za-z0-9_-]{1,100})\]', str(message.get('Subject', '')))
            if match:
                try:
                    ticket = store.get(match[1])
                    sender = email.utils.parseaddr(message.get('From', ''))[1].lower()
                    recipients = {address.lower() for event in ticket['events'] if event['type'] == 'sent'
                                  for address in event['detail'].get('to', [])}
                    body = message.get_body(preferencelist=('plain',))
                    snippet = (body.get_content() if body else '')[:4000]
                    # Sender address is not cryptographic authentication. Record observation; never auto-mark removed.
                    verdict = classify_reply(snippet)
                    if sender in recipients:
                        store.event(ticket['id'], 'reply', {'from': sender, 'snippet': snippet,
                                    'verdict': verdict, 'source': 'imap-unverified-sender'},
                                    status=verdict if verdict in ('acknowledged', 'needs_info', 'rejected') else None)
                except FetchError:
                    pass
            with store.connect() as db:
                db.execute('INSERT OR IGNORE INTO mail_seen VALUES (?)', (key,))
