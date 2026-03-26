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
echo ""
echo "Running post-ingest cleanup..."
echo "----------------------------------------------"

# Fast agency name cleanup (batch UPDATEs, doesn't slow ingestion)
python3 scripts/cleanup_agency_names.py 2>&1 | tee -a logs/pipeline_batch_$(date +%Y%m%d).log

echo ""
echo "Naming PDFs with LLaMA..."
echo "----------------------------------------------"

# Give PDFs logical names using keyword detection + LLaMA
python3 scripts/name_pdfs_llama.py 2>&1 | tee -a logs/pipeline_batch_$(date +%Y%m%d).log

echo ""
echo "Matching opportunities to member profiles..."
echo "----------------------------------------------"

# Match new opportunities to members and queue email notifications
python3 scripts/match_opportunities.py 2>&1 | tee -a logs/pipeline_batch_$(date +%Y%m%d).log

echo ""
echo "Pipeline batch complete at $(date)"
