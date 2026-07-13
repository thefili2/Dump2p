# Dump p2p

Dump is a hybrid chat application that combines the persistence of a server-based lobby with the absolute privacy of Peer-to-Peer (P2P) rooms. No account required.

## Features

### Main Chat (Server)

A global lobby where you can chat with anyone who is online. Messages are temporarily stored to show recent history, but they are automatically deleted after 24 hours.

### Private Rooms (P2P)

Direct browser-to-browser connections. Data is End-to-End encrypted. Once the room is closed, the data ceases to exist.

### Voice Channels

Optional audio channels inside private rooms. Audio flows directly between users through WebRTC and never reaches the server.

### File Sharing

Send images and documents (up to 5MB) directly through the P2P chat, without uploading anything to external servers.

### Privacy First

No registration required. You are identified only by a nickname and a random 4-digit session tag valid for the current session.

## Architecture

The project uses a hybrid architecture to provide the best of both worlds:

* **Flask & SQLite** manage the global Main Chat and user presence (online/offline).
* **PeerJS & WebRTC** manage Private Rooms, file transfers, and audio communication.

The server is only used for the initial signaling process (connection exchange). After that, data travels exclusively between clients.

## Tech Stack

* **Backend:** Python, Flask, SQLite
* **Frontend:** HTML5, CSS3, JavaScript (Vanilla)
* **P2P Engine:** PeerJS, WebRTC
* **Styling:** Native CSS (No frameworks)

## Local Setup

### Prerequisites

* Python 3.8+
* pip

### Installation

Clone the repository:

```bash
git clone https://github.com/thefili2/dump-p2p.git
cd dump-p2p
```

Create and activate a virtual environment (recommended):

```bash
python -m venv venv

# Linux/Mac
source venv/bin/activate

# Windows
venv\Scripts\activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the server:

```bash
python app.py
```

Open your browser and go to:

```text
http://localhost:5000
```

> **Important:** WebRTC requires a secure context (HTTPS) to work correctly, especially for microphone access and file sharing on some browsers. It works locally on `localhost`, but production deployments require SSL/HTTPS (for example with Nginx/Caddy and Let's Encrypt).


## License

This project is released under the MIT License. Feel free to use, modify, and distribute it.

```
```
