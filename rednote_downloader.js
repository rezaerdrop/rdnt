const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Helper download file chunking aman buat nanganin video HD ukuran besar (100MB+)
function downloadMediaSecure(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const client = url.startsWith('https') ? https : http;
        
        client.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://www.xiaohongshu.com/'
            }
        }, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                return downloadMediaSecure(response.headers.location, destPath).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Gagal download, status code: ${response.statusCode}`));
                return;
            }
            
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                const stats = fs.statSync(destPath);
                if (stats.size < 1000) {
                    reject(new Error(`File unduhan korup atau kosong (Ukuran: ${stats.size} bytes).`));
                } else {
                    resolve(destPath);
                }
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

async function getOriginTargetParams(rawUrl) {
    console.log('[*] Menyelesaikan URL redirect dan mengekstrak token...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    await page.goto(rawUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    const resolvedUrl = page.url();
    await browser.close();

    const urlObj = new URL(resolvedUrl);
    let targetUrl = resolvedUrl;
    if (urlObj.pathname.includes('/login') && urlObj.searchParams.has('redirectPath')) {
        targetUrl = decodeURIComponent(urlObj.searchParams.get('redirectPath'));
    }

    const targetObj = new URL(targetUrl);
    const parts = targetObj.pathname.split('/');
    const noteId = parts[parts.length - 1];
    const xsecToken = targetObj.searchParams.get('xsec_token') || '';

    return { noteId, xsecToken, targetUrl };
}

async function scrapeRedNote(rawUrl) {
    console.log(`[*] Mulai memproses: ${rawUrl}`);
    const outputDir = path.join(__dirname, 'rednote_downloads');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    let params;
    try {
        params = await getOriginTargetParams(rawUrl);
        console.log(`[*] Note ID: ${params.noteId}`);
        console.log(`[*] xsec_token: ${params.xsecToken}`);
    } catch (err) {
        console.error('[-] Gagal mengekstrak parameter URL:', err.message);
        throw new Error('Gagal mengekstrak parameter URL dari link tersebut.');
    }

    if (!params.noteId) {
        console.log('[-] Gagal memetakan Note ID dari tautan.');
        throw new Error('Gagal memetakan Note ID dari tautan Xiaohongshu.');
    }

    console.log('[*] Menembus celah OpenGraph API menggunakan UA Facebook External Hit...');
    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-web-security']
    });

    const context = await browser.newContext({
        userAgent: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();
    const cleanExploreUrl = `https://www.xiaohongshu.com/discovery/item/${params.noteId}?xsec_token=${encodeURIComponent(params.xsecToken)}`;
    
    try {
        console.log(`[*] Navigasi ke URL bypass: ${cleanExploreUrl}`);
        await page.goto(cleanExploreUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(6000);
        console.log(`[*] Halaman tercapai: ${page.url()}`);

        console.log('[*] Membongkar data murni dari memori window.__INITIAL_STATE__ ...');
        const extractData = await page.evaluate((nId) => {
            try {
                const s = window.__INITIAL_STATE__;
                if (!s || !s.note || !s.note.noteDetailMap) return { error: 'Tidak dapat menemukan noteDetailMap' };
                const noteObj = s.note.noteDetailMap[nId]?.note || s.note.noteDetailMap[Object.keys(s.note.noteDetailMap)[0]]?.note;
                if (!noteObj) return { error: 'Gagal mendapatkan struktur objek Note' };

                let result = {
                    title: noteObj.title || noteObj.desc?.substring(0, 40) || 'RedNote_Video',
                    desc: noteObj.desc || '',
                    type: noteObj.type,
                    urls: []
                };

                result.title = result.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').substring(0, 50);

                if (noteObj.type === 'video' || noteObj.video) {
                    result.type = 'video';
                    if (noteObj.video?.mediaV2) {
                        try {
                            const v2 = JSON.parse(noteObj.video.mediaV2);
                            if (v2.video?.opaque1?.hd_screencast_stream) {
                                result.urls.push(v2.video.opaque1.hd_screencast_stream);
                            } else if (v2.video?.opaque1?.default_screencast_stream) {
                                result.urls.push(v2.video.opaque1.default_screencast_stream);
                            }
                        } catch(e) {}
                    }

                    if (result.urls.length === 0) {
                        const streams = noteObj.video?.media?.stream?.h264 || noteObj.video?.media?.stream?.av1 || [];
                        if (streams.length > 0) {
                            const master = streams[0].masterUrl || streams[0].backupUrls?.[0];
                            if (master) result.urls.push(master);
                        }
                    }
                } else if (noteObj.imageList) {
                    result.type = 'images';
                    result.urls = noteObj.imageList.map(i => i.urlDefault || i.urlPre || i.url || i.infoList?.[0]?.url).filter(Boolean);
                }

                return result;
            } catch (e) {
                return { error: e.message };
            }
        }, params.noteId);

        if (extractData.error || !extractData.urls || extractData.urls.length === 0) {
            console.log('[-] Kegagalan bypass API XHS:', extractData.error || 'Media tidak ditemukan di JSON');
            await browser.close();
            throw new Error(extractData.error || 'Media tidak ditemukan di JSON');
        }

        console.log(`[+] Pengecekan Sukses! Menemukan ${extractData.urls.length} media (${extractData.type}) Kualitas Maksimal (HD).`);
        const timeStamp = Date.now();
        const saveDir = path.join(outputDir, `${extractData.title}_${timeStamp}`);
        if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

        let downloadedFiles = [];
        for (let i = 0; i < extractData.urls.length; i++) {
            let mediaUrl = extractData.urls[i];
            if (mediaUrl.startsWith('//')) mediaUrl = 'https:' + mediaUrl;
            
            const ext = extractData.type === 'video' ? '.mp4' : '.jpg';
            const fileName = `hd_media_${i + 1}${ext}`;
            const destPath = path.join(saveDir, fileName);
            
            console.log(`[*] Download Kualitas Tinggi (${i + 1}/${extractData.urls.length}) -> ${fileName}`);
            try {
                await downloadMediaSecure(mediaUrl, destPath);
                const stat = fs.statSync(destPath);
                console.log(`[+] SUKSES Download: ${destPath} (Ukuran: ${(stat.size / (1024*1024)).toFixed(2)} MB)`);
                downloadedFiles.push(destPath);
            } catch (err) {
                console.error(`[-] Gagal download ${mediaUrl}:`, err.message);
            }
        }
        console.log(`\n[+] Selesai! Semua file kualitas asli (HD) tersimpan di:\n${saveDir}`);
        return { files: downloadedFiles, type: extractData.type, title: extractData.title, desc: extractData.desc };

    } catch (error) {
        console.error('[-] Terjadi error saat scraping:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

if (require.main === module) {
    const urlArg = process.argv[2];
    if (!urlArg) {
        console.log('Masukkan URL Xiaohongshu!');
        process.exit(1);
    }
    scrapeRedNote(urlArg);
}

module.exports = { scrapeRedNote };
