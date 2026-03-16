#!/bin/bash
printf "Paste your DigitalOcean API token (starts with dop_v1_): "
read -rs DO_TOKEN
echo ""
sed -i '' "s|^DO_TOKEN=.*|DO_TOKEN=${DO_TOKEN}|" ~/awardopedia/.env
echo "✓ DO token updated (length: ${#DO_TOKEN})"
