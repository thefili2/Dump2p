from flask import Flask, request, jsonify, render_template
import sqlite3
import os
import time
import re
import threading
from datetime import datetime, timedelta
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask import send_from_directory

app = Flask(__name__)

limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per minute"]
)

DB_PATH = 'dump2p.db'



def cleanup_old_messages():
    try:
        conn = sqlite3.connect(DB_PATH)
        cutoff = int((time.time() - (30 * 24 * 60 * 60)) * 1000)
        conn.execute("DELETE FROM main_chat WHERE timestamp < ?", (cutoff,))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Errore cleanup: {e}")

def run_cleanup_periodically():
    while True:
        time.sleep(24 * 60 * 60) 
        cleanup_old_messages()



@app.route('/robots.txt')
def robots_txt():
    return send_from_directory(os.path.dirname(__file__), 'robots.txt', mimetype='text/plain')

@app.route('/sitemap.xml')
def sitemap_xml():
    return send_from_directory(os.path.dirname(__file__), 'sitemap.xml', mimetype='application/xml')

@app.after_request
def add_security_headers(response):
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

@app.route('/favicon.ico')
def favicon():
    return '', 204

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL") 
    return conn

def init_db():
    conn = get_db_connection()
    conn.execute('''CREATE TABLE IF NOT EXISTS system (key TEXT PRIMARY KEY, value INTEGER)''')
    conn.execute('''INSERT OR IGNORE INTO system (key, value) VALUES ('tag_counter', 0)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS main_chat (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, text TEXT, timestamp INTEGER)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS online_users (nickname_tag TEXT PRIMARY KEY, last_heartbeat INTEGER)''')
    conn.commit()
    conn.close()
    
    cleanup_old_messages()

# 3. FIX: Prevenzione Path Traversal
# 3. FIX: Prevenzione Path Traversal
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/<path:page>')
def serve_pages(page):
    if '..' in page or page.startswith('/'):
        return "Pagina non trovata", 404
        
    if not page.endswith('.html'):
        return "Pagina non trovata", 404

    try:
        return render_template(page)
    except:
        return "Pagina non trovata", 404

@app.route('/api/tag', methods=['GET'])
@limiter.limit("5 per minute")  
def get_tag():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE system SET value = value + 1 WHERE key = 'tag_counter'")
    cursor.execute("SELECT value FROM system WHERE key = 'tag_counter'")
    tag_val = cursor.fetchone()['value']
    conn.commit()
    conn.close()
    return jsonify({"tag": str(tag_val % 10000).zfill(4)})

@app.route('/api/join-main-chat', methods=['POST'])
def join_main_chat():
    data = request.json
    if not data or not data.get('nickname_tag'):
        return jsonify({"error": "Dati mancanti"}), 400
    conn = get_db_connection()
    now = int(time.time() * 1000)
    conn.execute(
        "INSERT OR REPLACE INTO online_users (nickname_tag, last_heartbeat) VALUES (?, ?)", 
        (data['nickname_tag'], now)
    )
    conn.commit()
    conn.close()
    return jsonify({"status": "ok"})

@app.route('/api/main-chat', methods=['POST'])
@limiter.limit("10 per minute")
def send_message():
    data = request.json
    if not data or not data.get('text') or not data.get('sender'):
        return jsonify({"error": "Dati mancanti"}), 400
    
    if len(data['text']) > 2000 or len(data['sender']) > 30:
        return jsonify({"error": "Messaggio troppo lungo"}), 400
        
    server_timestamp = int(time.time() * 1000)
    
    conn = get_db_connection()
    conn.execute(
        "INSERT INTO main_chat (sender, text, timestamp) VALUES (?, ?, ?)", 
        (data['sender'], data['text'], server_timestamp)
    )
    conn.commit()
    conn.close()
    
    return jsonify({"status": "ok", "timestamp": server_timestamp}), 201

@app.route('/api/heartbeat', methods=['POST'])
def heartbeat():
    data = request.json
    if not data or not data.get('nickname_tag'):
        return jsonify({"error": "Dati mancanti"}), 400
    conn = get_db_connection()
    now = int(time.time() * 1000)
    conn.execute(
        "UPDATE online_users SET last_heartbeat = ? WHERE nickname_tag = ?", 
        (now, data['nickname_tag'])
    )
    conn.commit()
    conn.close()
    return jsonify({"status": "ok"})

@app.route('/api/online-users', methods=['GET'])
@limiter.limit("5 per minute")  
def get_online_users():
    conn = get_db_connection()
    now = int(time.time() * 1000)
    threshold = now - 45000 
    
    cursor = conn.execute(
        "SELECT nickname_tag FROM online_users WHERE last_heartbeat > ?", 
        (threshold,)
    )
    users = [row['nickname_tag'] for row in cursor.fetchall()]
    
    conn.execute("DELETE FROM online_users WHERE last_heartbeat <= ?", (threshold,))
    conn.commit()
    conn.close()
    return jsonify(users)

@app.route('/api/leave-main-chat', methods=['POST'])
def leave_main_chat():
    data = request.json
    if not data or not data.get('nickname_tag'):
        return jsonify({"error": "Dati mancanti"}), 400
    conn = get_db_connection()
    conn.execute("DELETE FROM online_users WHERE nickname_tag = ?", (data['nickname_tag'],))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok"})

@app.route('/api/main-chat', methods=['GET'])
@limiter.limit("5 per minute")  
def get_messages():
    after = request.args.get('after', type=int)
    conn = get_db_connection()
    cursor = conn.cursor()
    if after:
        cursor.execute(
            "SELECT * FROM main_chat WHERE timestamp > ? ORDER BY timestamp ASC", 
            (after,)
        )
    else:
        cursor.execute(
            "SELECT * FROM (SELECT * FROM main_chat ORDER BY timestamp DESC LIMIT 50) ORDER BY timestamp ASC"
        )
    messages = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify(messages)

@app.route('/api/validate-room')
def validate_room():
    room_id = request.args.get('room', '')
    if not re.match(r'^room-[a-f0-9]{24}$', room_id):
        return jsonify({"valid": False}), 400
    return jsonify({"valid": True})

if __name__ == '__main__':
    init_db()
    
    cleanup_thread = threading.Thread(target=run_cleanup_periodically, daemon=True)
    cleanup_thread.start()
    
    app.run(debug=False, port=12000)
