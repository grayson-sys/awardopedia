#!/bin/bash
# Run pipeline on all SAM.gov opportunity files
# Stage 6 includes title cleaning via Claude

cd /Users/openclaw/awardopedia
source .venv/bin/activate

echo "Starting pipeline batch run at $(date)"
echo "=============================================="

# Process each file
for file in data/sam_all_opps_*.json; do
    echo ""
    echo "Processing: $file"
    echo "Started: $(date)"

    python3 scripts/pipeline_opportunity.py --from-file "$file" 2>&1 | tee -a logs/pipeline_batch_$(date +%Y%m%d).log

    echo "Completed: $(date)"
    echo "----------------------------------------------"

    # Brief pause between files
    sleep 5
done

echo ""
echo "=============================================="
echo "All files processed at $(date)"
