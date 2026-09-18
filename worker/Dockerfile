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
RUN mkdir -p /recordings /data && \
    groupadd -g 1000 workergrp && \
    useradd -u 1000 -g workergrp workeruser && \
    chown -R 1000:1000 /recordings /data

# Set environment variables
# CONFIG_DIR is the internal stack default; can be overridden at runtime
# Individual *_PATH overrides take precedence over CONFIG_DIR
ENV CONFIG_DIR=/data \
    OUTPUT_DIR=/recordings \
    POLL_INTERVAL=60

# Drop root privileges and run as non-root user
USER workeruser

# Unbuffered output for docker logs
CMD ["python", "-u", "worker.py"]
