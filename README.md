# Battle Bound - online multiplayer

This folder is the whole thing: the game page (`public/index.html`) and the
multiplayer server (`server.js`). The server hosts the page AND runs the cloud
variable connection, so players only need your site's link. No login.

## Run it on your computer to test
    npm install
    npm start
Open http://localhost:3000 in two browser windows, pick different usernames.

## Put it online (free option: Render.com)
1. Make a free GitHub account and create a new repository.
2. Upload everything in this folder to it (not the node_modules folder).
3. On render.com: New > Web Service > connect that repository.
4. Settings: Runtime = Node, Build Command = `npm install`, Start Command = `npm start`, Instance type = Free.
5. Deploy. Render gives you a link like https://battle-bound.onrender.com. Share it.

Any host that runs Node.js and supports WebSockets works (Railway, Fly.io, a VPS).
Static-only hosts (Netlify, GitHub Pages, itch.io) cannot run the server.

Notes
- Free hosts usually put the server to sleep when nobody is playing, so the first
  visitor may wait around a minute for it to wake up.
- Game state lives in memory. It resets when everyone has left or the server restarts.
- Optional setting (environment variable): MAX_PLAYERS (default 50 per room).
