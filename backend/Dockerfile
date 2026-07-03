# Gunakan image Python ringan
FROM python:3.11-slim

# Set direktori kerja di dalam container
WORKDIR /app

# Salin file requirements dan install dependensi
# (Pastikan Anda punya file requirements.txt di folder backend)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Salin seluruh kode backend
COPY . .

# Eksekusi FastAPI (Sesuaikan 'main:app' jika nama file utama Anda berbeda, misalnya 'server:app')
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
