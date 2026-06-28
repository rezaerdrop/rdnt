# Menggunakan image base resmi Playwright (sudah termasuk Node.js dan browser Chromium/WebKit bawaan OS)
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

# Set direktori kerja di dalam container
WORKDIR /app

# Salin file konfigurasi paket
COPY package*.json ./

# Install dependencies Node.js
RUN npm install

# Salin seluruh file bot dan scraper ke dalam container
COPY . .

# Ekspos port server Web API
EXPOSE 3000

# Eksekusi server utama
CMD ["npm", "start"]
