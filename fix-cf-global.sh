#!/bin/bash
printf "Cloudflare account email: "
read -r CF_EMAIL
printf "Cloudflare Global API Key: "
read -rs CF_KEY
echo ""

sed -i '' '/^CLOUDFLARE_API_TOKEN=/d' ~/awardopedia/.env
sed -i '' '/^CLOUDFLARE_EMAIL=/d' ~/awardopedia/.env

echo "CLOUDFLARE_EMAIL=${CF_EMAIL}" >> ~/awardopedia/.env
echo "CLOUDFLARE_API_KEY=${CF_KEY}" >> ~/awardopedia/.env

echo "✓ Updated — using Global API Key auth"
