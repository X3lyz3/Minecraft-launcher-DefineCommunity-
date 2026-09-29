const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { Client, Authenticator } = require('minecraft-launcher-core');
const path = require('path');
const fs = require('fs');

let mainWindow;
const launcher = new Client();
let running = false;

function send(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 640,
        resizable: false,
        autoHideMenuBar: true,
        backgroundColor: '#14161d',
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
});

function copyIfExists(from, to) {
    if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true });
}

function injectServerData(gamePath) {
    // 1. Объявляем переменную с именем bundledPath (проверяем на .exe)
    const bundledPath = app.isPackaged 
        ? path.join(process.resourcesPath, 'bundled_data') 
        : path.join(__dirname, 'bundled_data');
    
    if (!fs.existsSync(gamePath)) {
        fs.mkdirSync(gamePath, { recursive: true });
    }
    
    // 2. Везде ниже используем именно bundledPath
    const modsDest = path.join(gamePath, 'mods');
    if (fs.existsSync(path.join(bundledPath, 'mods'))) {
        fs.cpSync(path.join(bundledPath, 'mods'), modsDest, { recursive: true });
    }

    const versionsDest = path.join(gamePath, 'versions');
    if (fs.existsSync(path.join(bundledPath, 'versions'))) {
        fs.cpSync(path.join(bundledPath, 'versions'), versionsDest, { recursive: true });
    }

    const librariesDest = path.join(gamePath, 'libraries');
    if (fs.existsSync(path.join(bundledPath, 'libraries'))) {
        fs.cpSync(path.join(bundledPath, 'libraries'), librariesDest, { recursive: true });
    }

    const serverDatDest = path.join(gamePath, 'servers.dat');
    if (fs.existsSync(path.join(bundledPath, 'servers.dat')) && !fs.existsSync(serverDatDest)) {
        fs.copyFileSync(path.join(bundledPath, 'servers.dat'), serverDatDest);
    }
}

// Слухачі реєструємо один раз, а не при кожному запуску
launcher.on('debug', e => console.log(e));
launcher.on('data', e => { console.log(e); send('log', e); });
launcher.on('progress', e => send('progress', e));
launcher.on('package-extract', () => send('log', 'Розпакування файлів…'));
launcher.on('close', code => {
    running = false;
    console.log(`Exit code: ${code}`);
    send('closed', code);
});

ipcMain.on('start-game', async (event, config) => {
    if (running) return;
    running = true;

    try {
        injectServerData(config.path);
    } catch (err) {
        running = false;
        return send('error', `Не вдалося підготувати теку гри: ${err.message}`);
    }

    const ram = Math.max(512, Number(config.ram) || 4096);

    const opts = {
        authorization: Authenticator.getAuth(config.username),
        root: config.path,
        version: { number: '26.3', type: 'release', custom: 'fabric-26.3' },
        memory: { max: `${ram}M`, min: `${Math.min(1024, ram)}M` },
        window: {
            width: Number(config.width) || 1280,
            height: Number(config.height) || 720,
            fullscreen: !!config.fullscreen
        },
        javaPath: app.isPackaged 
            ? path.join(process.resourcesPath, 'bundled_data', 'java', 'bin', 'javaw.exe')
            : path.join(__dirname, 'bundled_data', 'java', 'bin', 'javaw.exe')
    };

    try {
        const proc = await launcher.launch(opts);
        if (proc) send('started');
        else { running = false; send('error', 'Гра не запустилася. Подробиці в консолі npm start.'); }
    } catch (err) {
        running = false;
        send('error', `Помилка запуску: ${err.message}`);
    }
});
