const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { scrapeRedNote } = require('./rednote_downloader');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup Express Endpoint untuk Ping & Test Web API
app.use(express.json());

app.get('/', (req, res) => {
    res.send('🚀 RedNote Bot & Scraper API is Running! 🔥');
});

// Endpoint web API: /download?url=https://...
app.get('/download', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'Berikan parameter url Xiaohongshu!' });

    try {
        const data = await scrapeRedNote(targetUrl);
        res.json({
            success: true,
            title: data.title,
            desc: data.desc,
            type: data.type,
            fileCount: data.files.length,
            message: 'Semua media berhasil diunduh ke direktori rednote_downloads server.'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Setup Telegram Bot (Opsional: Aktif jika TELEGRAM_BOT_TOKEN ada di ENV)
const token = process.env.TELEGRAM_BOT_TOKEN;

if (token) {
    console.log('[*] Inisialisasi Telegram Bot...');
    const bot = new TelegramBot(token, { polling: true });

    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, `🔥 *Selamat Datang di RedNote HD Downloader Bot!* 🔥\n\nKirimkan tautan Xiaohongshu (seperti \`http://xhslink.com/...\` atau \`https://www.xiaohongshu.com/...\`) ke chat ini, dan gue bakal sedot video MP4 / Foto kualitas murni buat lo! 🚀`, { parse_mode: 'Markdown' });
    });

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text || '';

        if (text.includes('xhslink.com') || text.includes('xiaohongshu.com')) {
            const statusMsg = await bot.sendMessage(chatId, `⏳ *Sedang menerobos API RedNote...* Mohon tunggu sebentar (dapat memakan waktu 30-60 detik).`, { parse_mode: 'Markdown' });

            try {
                const data = await scrapeRedNote(text);
                
                await bot.editMessageText(`📦 *Media Kualitas HD berhasil diekstrak!* Sedang mengirim file ke chat lo...`, {
                    chat_id: chatId,
                    message_id: statusMsg.message_id,
                    parse_mode: 'Markdown'
                });

                // Kirim semua file ke Telegram
                for (const filePath of data.files) {
                    if (data.type === 'video') {
                        await bot.sendVideo(chatId, fs.createReadStream(filePath), {
                            caption: `🔥 *${data.title}*\n\n${data.desc}`,
                            parse_mode: 'Markdown'
                        });
                    } else {
                        await bot.sendPhoto(chatId, fs.createReadStream(filePath), {
                            caption: `🔥 *${data.title}*`,
                            parse_mode: 'Markdown'
                        });
                    }
                }

                await bot.sendMessage(chatId, `✅ *Berhasil terkirim!* Gas kirim link lainnya. 🔥`, { parse_mode: 'Markdown' });

            } catch (err) {
                bot.sendMessage(chatId, `❌ *Gagal mengunduh media dari tautan tersebut.*\n\nPesan Error: \`${err.message}\``, { parse_mode: 'Markdown' });
            }
        }
    });
} else {
    console.log('[!] TELEGRAM_BOT_TOKEN tidak ditemukan. Bot Telegram dilewati. Hanya menjalankan Web API.');
}

app.listen(PORT, () => {
    console.log(`[+] Server Web API Berjalan di Port: ${PORT}`);
});
