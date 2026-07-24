'use strict';
// Builds the itch.io-ready client zip with the room-server address baked in.
// Usage: node build-itch.js wss://your-room-server.onrender.com
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const server = process.argv[2];
if (!server || !/^wss?:\/\//.test(server)) {
  console.error('usage: node build-itch.js wss://your-room-server.example.com');
  process.exit(1);
}
const root = __dirname;
const dist = path.join(root, 'dist', 'itch');
fs.rmSync(path.join(root, 'dist'), {recursive: true, force: true});
fs.mkdirSync(dist, {recursive: true});

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const tag = '<script src="game.js">';
if (!html.includes(tag)) { console.error('index.html: game.js script tag not found'); process.exit(1); }
html = html.replace(tag, `<script>window.LR4_SERVER=${JSON.stringify(server)};</script>\n${tag}`);
fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.copyFileSync(path.join(root, 'game.js'), path.join(dist, 'game.js'));
const sfx = path.join(root, 'sfx');
if (fs.existsSync(sfx)) fs.cpSync(sfx, path.join(dist, 'sfx'), {recursive: true});
const music = path.join(root, 'music');
if (fs.existsSync(music)) fs.cpSync(music, path.join(dist, 'music'), {recursive: true});

const zip = path.join(root, 'dist', 'laser-revolution-4-itch.zip');
cp.execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${dist}\\*' -DestinationPath '${zip}' -Force"`);
console.log('itch build ready: ' + zip);
console.log('room server baked in: ' + server);
console.log('upload the zip on itch.io with "This file will be played in the browser" checked.');
