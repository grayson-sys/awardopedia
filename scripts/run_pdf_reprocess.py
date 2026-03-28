#!/usr/bin/env python3
"""
run_pdf_reprocess.py — Reprocess records through stages 2-6 (PDF download + AI).

Usage:
  python3 scripts/run_pdf_reprocess.py /tmp/pdf_reprocess_batch_1.json
"""

import os, sys, json, subprocess
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 run_pdf_reprocess.py <batch_file.json>")
        sys.exit(1)

    batch_file = Path(sys.argv[1])
    if not batch_file.exists():
        print(f"Batch file not found: {batch_file}")
        sys.exit(1)

    notice_ids = json.loads(batch_file.read_text())
    print(f"Reprocessing {len(notice_ids)} opportunities through stages 2-6 (PDF + AI)")

    base_dir = Path(__file__).parent.parent
    os.chdir(base_dir)

    success = 0
    failed = 0

    for i, notice_id in enumerate(notice_ids, 1):
        print(f"\n[{i}/{len(notice_ids)}] {notice_id}")

        try:
            result = subprocess.run(
                ['python3', 'scripts/pipeline_opportunity.py',
                 '--notice-id', notice_id,
                 '--stage', '2-6'],  # PDF download through AI summary
                capture_output=True,
                text=True,
                timeout=300  # 5 min per record (PDF download can be slow)
            )

            if result.returncode == 0:
                success += 1
                # Print relevant output lines
                for line in result.stdout.split('\n'):
                    if '[S2]' in line or '[S6]' in line or 'words' in line.lower():
                        print(f"  {line.strip()}")
            else:
                failed += 1
                print(f"  FAILED: {result.stderr[:200] if result.stderr else 'Unknown error'}")

        except subprocess.TimeoutExpired:
            failed += 1
            print(f"  TIMEOUT after 5 minutes")
        except Exception as e:
            failed += 1
            print(f"  ERROR: {e}")

    print(f"\n{'='*60}")
    print(f"BATCH COMPLETE: {success} success, {failed} failed")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
