FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as an unprivileged user
RUN useradd --create-home appuser
USER appuser

ENV PORT=8000 TRUST_PROXY=1
EXPOSE 8000

# Several threads, one process: the DB client and login lockout state live in memory per process.
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT} --workers 1 --threads 8 --timeout 60 app:app"]
