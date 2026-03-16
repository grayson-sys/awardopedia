#!/bin/bash
printf "Paste your Cloudflare API token (the long random string, not a URL): "
read -rs CF_TOKEN
echo ""

# Replace the existing CLOUDFLARE_API_TOKEN line
if grep -q "^CLOUDFLARE_API_TOKEN=" ~/awardopedia/.env; then
  # macOS sed -i requires extension
  sed -i '' "s|^CLOUDFLARE_API_TOKEN=.*|CLOUDFLARE_API_TOKEN=${CF_TOKEN}|" ~/awardopedia/.env
  echo "✓ Cloudflare token updated"
else
  echo "CLOUDFLARE_API_TOKEN=${CF_TOKEN}" >> ~/awardopedia/.env
  echo "✓ Cloudflare token added"
fi
