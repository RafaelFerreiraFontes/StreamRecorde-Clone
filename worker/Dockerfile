FROM python:3.12-slim

# ffmpeg é usado pelo Streamlink internamente para remuxar/gerar o MP4
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir streamlink

WORKDIR /app
COPY worker.py .

# Pastas montadas via volume no docker-compose
RUN mkdir -p /recordings /app/config

ENV WATCHLIST_PATH=/app/config/watchlist.json \
    STATUS_PATH=/app/config/status.json \
    OUTPUT_DIR=/recordings \
    POLL_INTERVAL=60

CMD ["python", "-u", "worker.py"]
