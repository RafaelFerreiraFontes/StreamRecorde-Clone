FROM python:3.12-slim

# ffmpeg is used by Streamlink for remuxing to MP4
# ca-certificates for HTTPS when checking/updating configs
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

WORKDIR /app

# Copy worker modules
COPY worker.py .
COPY json_adapters.py .

# Create runtime directories
RUN mkdir -p /recordings /app/config

# Environment variables for paths (can be overridden via docker-compose or runtime)
ENV WATCHLIST_PATH=/app/config/watchlist.json \
    CHANNELS_STATUS_PATH=/app/config/channels_status.json \
    SESSIONS_PATH=/app/config/sessions.json \
    STREAMS_PATH=/app/config/streams.json \
    OUTPUT_DIR=/recordings \
    POLL_INTERVAL=60

# Unbuffered output for docker logs
CMD ["python", "-u", "worker.py"]
