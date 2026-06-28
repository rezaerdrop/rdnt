# Menggunakan image base resmi Playwright versi 1.61.0 (cocok dengan package.json)
FROM mcr.microsoft.com/playwright:v1.61.0-jammy

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
