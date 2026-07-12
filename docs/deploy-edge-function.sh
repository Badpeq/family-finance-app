#!/usr/bin/env bash
# Deploy a Supabase Edge Function using the Management API
# Workaround for Docker bundler bind-mount write bug (exits 0 but doesn't write to file)
#
# Usage: ./deploy-edge-function.sh <function-name>
# Requires: SUPABASE_ACCESS_TOKEN env var or sbp_... token
# Requires: Python3 + brotli (pip3 install --break-system-packages brotli)

set -euo pipefail

FUNCTION_SLUG="${1:-ingest-transaction}"
PROJECT_REF="tsdawpxiqqnesikcqlex"
FUNCTIONS_DIR="$(dirname "$0")/../supabase/functions"
FUNCTION_DIR="${FUNCTIONS_DIR}/${FUNCTION_SLUG}"
SUPABASE_TOKEN="${SUPABASE_ACCESS_TOKEN:-sbp_61a65719812b978e06c911bcda12970d4ca62169}"
DOCKER_NETWORK="supabase_network_${PROJECT_REF}"
DENO_CACHE_VOL="supabase_edge_runtime_${PROJECT_REF}"

echo "Bundling ${FUNCTION_SLUG}..."

# Step 1: Bundle to stdout (workaround: bundler can't write to bind-mount volumes)
ESZIP_FILE="/tmp/eszip_${FUNCTION_SLUG}.eszip"
docker run --rm \
  --network "${DOCKER_NETWORK}" \
  -v "${FUNCTIONS_DIR}:/tmp/supabase-functions-source:ro" \
  -v "${DENO_CACHE_VOL}:/root/.cache/deno:rw" \
  public.ecr.aws/supabase/edge-runtime:v1.74.2 bundle \
  --entrypoint "/tmp/supabase-functions-source/${FUNCTION_SLUG}/index.ts" \
  --output /dev/stdout 2>/dev/null > "${ESZIP_FILE}"

ESZIP_SIZE=$(wc -c < "${ESZIP_FILE}")
echo "Bundled: ${ESZIP_SIZE} bytes"

# Step 2: EZBR + brotli compress + SHA-256
PAYLOAD_FILE="/tmp/eszip_${FUNCTION_SLUG}_payload.bin"
SHA256=$(python3 -c "
import brotli, hashlib, sys
with open('${ESZIP_FILE}', 'rb') as f:
    eszip = f.read()
payload = b'EZBR' + brotli.compress(eszip, quality=6)
with open('${PAYLOAD_FILE}', 'wb') as f:
    f.write(payload)
print(hashlib.sha256(payload).hexdigest())
")
echo "SHA-256: ${SHA256}"

# Step 3: Get the entrypoint URL from the eszip (first module path)
ENTRY_MODULE="${FUNCTION_SLUG}/index.ts"
ENTRYPOINT_URL="file:///tmp/supabase-functions-source/${ENTRY_MODULE}"

# Step 4: Deploy via Management API PATCH
echo "Deploying..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/${FUNCTION_SLUG}?verify_jwt=false&entrypoint_path=${ENTRYPOINT_URL}&ezbr_sha256=${SHA256}" \
  -H "Authorization: Bearer ${SUPABASE_TOKEN}" \
  -H "Content-Type: application/vnd.denoland.eszip" \
  --data-binary "@${PAYLOAD_FILE}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✓ Deployed ${FUNCTION_SLUG} successfully"
  echo "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'  version: {d[\"version\"]}, status: {d[\"status\"]}')"
else
  echo "✗ Deploy failed (HTTP ${HTTP_CODE}): ${BODY}"
  exit 1
fi

# Cleanup
rm -f "${ESZIP_FILE}" "${PAYLOAD_FILE}"
