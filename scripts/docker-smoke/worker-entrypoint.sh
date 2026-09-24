#!/bin/sh
set -eu

mkdir -p /tmp/streamrecorder-smoke-bin
cp /smoke-fixture/streamlink-fixture.py /tmp/streamrecorder-smoke-bin/streamlink-fixture.py
printf '#!/bin/sh\nexec python /tmp/streamrecorder-smoke-bin/streamlink-fixture.py "$@"\n' > /tmp/streamrecorder-smoke-bin/streamlink
chmod 755 /tmp/streamrecorder-smoke-bin/streamlink

if [ "$#" -gt 0 ]; then
	exec "$@"
fi

exec python -u /app/worker.py